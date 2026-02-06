import {
  AuthenticationResult,
  InteractionRequiredAuthError,
  InteractionStatus,
  AccountInfo,
} from "@azure/msal-browser";
import { useMsal } from "@azure/msal-react";
import { MantineProvider } from "@mantine/core";
import React, {
  createContext,
  ReactNode,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";

import {
  CACHE_KEY_PREFIX,
  setCachedResponse,
  getCachedResponse,
  clearAuthCache,
} from "../AuthGuard/index.js";

import FullScreenLoader from "./LoadingScreen.js";

import { getRunEnvironmentConfig, ValidServices } from "@ui/config.js";
import { transformCommaSeperatedName } from "@common/utils.js";
import { OrgRoleDefinition } from "@common/roles.js";

interface AuthContextDataWrapper {
  isLoggedIn: boolean;
  isAuthInitialized: boolean; // NEW: signals when auth + roles are fully loaded
  userData: AuthContextData | null;
  orgRoles: OrgRoleDefinition[];
  loginMsal: CallableFunction;
  logout: CallableFunction;
  getToken: CallableFunction;
  logoutCallback: CallableFunction;
  getApiToken: CallableFunction;
  setLoginStatus: CallableFunction;
  refreshOrgRoles: () => Promise<void>;
}

export type AuthContextData = {
  email?: string;
  name?: string;
};

export const AuthContext = createContext({} as AuthContextDataWrapper);

export const useAuth = () => useContext(AuthContext);

interface AuthProviderProps {
  children: ReactNode;
}

export { clearAuthCache };

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const { instance, inProgress, accounts } = useMsal();
  const [userData, setUserData] = useState<AuthContextData | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [isAuthInitialized, setIsAuthInitialized] = useState<boolean>(false); // NEW
  const [orgRoles, setOrgRoles] = useState<OrgRoleDefinition[]>([]);
  const orgRolesRef = useRef(orgRoles);
  orgRolesRef.current = orgRoles;

  const config = getRunEnvironmentConfig().ServiceConfiguration.core;
  const checkRoute = config.authCheckRoute;

  if (!checkRoute) {
    throw new Error("no check route found!");
  }

  /**
   * Helper to manually get a token without relying on the external API hook/context
   * Uses the Core API's proper scope and resource to ensure correct token audience
   */
  const acquireTokenInternal = useCallback(
    async (account: AccountInfo, forceRefresh: boolean = false) => {
      try {
        const coreConfig = getRunEnvironmentConfig().ServiceConfiguration.core;
        const scope = coreConfig.loginScope;
        const apiId = coreConfig.apiId;

        if (!scope || !apiId) {
          console.error("Core API scope or apiId not configured");
          return null;
        }

        const response = await instance.acquireTokenSilent({
          account,
          scopes: [scope],
          forceRefresh,
        });
        return response.accessToken;
      } catch (error) {
        console.warn(
          "Silent token acquisition failed inside AuthProvider",
          error,
        );
        return null;
      }
    },
    [instance],
  );

  /**
   * Fetch and update org roles.
   * Accepts an explicit account to handle race conditions during login redirects.
   */
  const fetchOrgRoles = useCallback(
    async (explicitAccount?: AccountInfo, isRetry: boolean = false) => {
      try {
        // 1. Check cache first
        const cachedData = await getCachedResponse("core", checkRoute);
        if (cachedData?.data?.orgRoles) {
          setOrgRoles(cachedData.data.orgRoles || []);
          return cachedData.data.orgRoles;
        }

        // 2. Determine which account to use
        const account =
          explicitAccount || instance.getActiveAccount() || accounts[0];

        if (!account) {
          return [];
        }

        // 3. Get token manually
        const token = await acquireTokenInternal(account);

        if (!token) {
          return [];
        }

        // 4. Fetch fresh data manually
        const fullCheckRoute = `${config.baseEndpoint}${checkRoute}`;
        const response = await fetch(fullCheckRoute, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          // Handle authentication errors - token likely expired or invalid
          if (response.status === 401 || response.status === 403) {
            console.warn(
              `Auth token rejected (status: ${response.status}). Clearing cache.`,
            );
            clearAuthCache();

            // Try to refresh the token once
            if (!isRetry) {
              const freshToken = await acquireTokenInternal(account, true);
              if (freshToken) {
                // Try again with fresh token
                const retryResponse = await fetch(fullCheckRoute, {
                  method: "GET",
                  headers: {
                    Authorization: `Bearer ${freshToken}`,
                    "Content-Type": "application/json",
                  },
                });

                if (retryResponse.ok) {
                  const data = await retryResponse.json();
                  await setCachedResponse("core", checkRoute, data);
                  if (data?.orgRoles) {
                    setOrgRoles(data.orgRoles || []);
                    return data.orgRoles;
                  }
                  return [];
                }
                console.error(
                  `Retry fetch failed with status: ${retryResponse.status}`,
                  await retryResponse
                    .text()
                    .catch(() => "Could not read response body"),
                );
              }
            }
          }
          throw new Error(`Auth check failed with status: ${response.status}`);
        }

        const data = await response.json();

        // 5. Cache and Set
        await setCachedResponse("core", checkRoute, data);

        if (data?.orgRoles) {
          setOrgRoles(data.orgRoles || []);
          return data.orgRoles;
        }

        return [];
      } catch (error) {
        console.error("Failed to fetch org roles:", error);
        return orgRolesRef.current;
      }
    },
    [checkRoute, instance, accounts, acquireTokenInternal],
  );

  // Refresh org roles on demand
  const refreshOrgRoles = useCallback(async () => {
    const cacheKey = `${CACHE_KEY_PREFIX}core_${checkRoute}`;
    sessionStorage.removeItem(cacheKey);
    await fetchOrgRoles();
  }, [checkRoute, fetchOrgRoles]);

  const handleMsalResponse = useCallback(
    async (response: AuthenticationResult) => {
      if (response?.account) {
        instance.setActiveAccount(response.account);

        setUserData({
          email: response.account.username,
          name: transformCommaSeperatedName(response.account.name || ""),
        });

        // Fetch roles using the account from the response
        await fetchOrgRoles(response.account);

        setIsLoggedIn(true);
      }
    },
    [instance, fetchOrgRoles],
  );

  // Main Effect for handling MSAL Redirects
  useEffect(() => {
    const handleRedirect = async () => {
      try {
        const response = await instance.handleRedirectPromise();

        if (response) {
          // Returning from auth redirect
          await handleMsalResponse(response);
        } else if (accounts.length > 0) {
          // Normal page load - already logged in
          const activeAccount = accounts[0];
          instance.setActiveAccount(activeAccount);

          setUserData({
            email: activeAccount.username,
            name: transformCommaSeperatedName(activeAccount.name || ""),
          });

          await fetchOrgRoles(activeAccount);
          setIsLoggedIn(true);
        }
        // else: No response and no accounts = not logged in, which is fine
      } catch (error) {
        console.error("Handle redirect error:", error);
      } finally {
        // CRITICAL: Always mark initialization complete, regardless of outcome
        setIsAuthInitialized(true);
      }
    };

    if (inProgress === InteractionStatus.None) {
      handleRedirect();
    }
  }, [inProgress, accounts, instance, handleMsalResponse, fetchOrgRoles]);

  const getApiToken = useCallback(
    async (service: ValidServices) => {
      if (!userData) {
        return null;
      }
      const scope =
        getRunEnvironmentConfig().ServiceConfiguration[service].loginScope;
      const { apiId } = getRunEnvironmentConfig().ServiceConfiguration[service];
      if (!scope || !apiId) {
        return null;
      }
      const msalAccounts = instance.getAllAccounts();
      if (msalAccounts.length > 0) {
        const silentRequest = {
          account: msalAccounts[0],
          scopes: [scope],
          resource: apiId,
        };
        const tokenResponse = await instance.acquireTokenSilent(silentRequest);
        return tokenResponse.accessToken;
      }
      throw new Error("No accounts found, cannot proceed.");
    },
    [userData, instance],
  );

  const getToken = useCallback(async () => {
    if (!userData) {
      return null;
    }
    try {
      const msalAccounts = instance.getAllAccounts();
      if (msalAccounts.length > 0) {
        const silentRequest = {
          account: msalAccounts[0],
          scopes: [".default"],
        };
        const tokenResponse = await instance.acquireTokenSilent(silentRequest);
        return tokenResponse.accessToken;
      }
      throw new Error("No accounts found, cannot proceed.");
    } catch (error) {
      console.error("Silent token acquisition failed.", error);
      if (error instanceof InteractionRequiredAuthError) {
        try {
          const interactiveRequest = {
            scopes: [".default"],
            redirectUri: "/auth/callback",
          };
          const tokenResponse: any =
            await instance.acquireTokenRedirect(interactiveRequest);
          return tokenResponse.accessToken;
        } catch (interactiveError) {
          console.error(
            "Interactive token acquisition failed.",
            interactiveError,
          );
          throw interactiveError;
        }
      } else {
        throw error;
      }
    }
  }, [userData, instance]);

  const loginMsal = useCallback(
    async (returnTo: string) => {
      if (!checkRoute) {
        throw new Error("could not get user roles!");
      }

      const request = {
        scopes: ["openid", "profile", "email"],
        state: returnTo,
      };

      const currentAccounts = instance.getAllAccounts();

      if (currentAccounts.length > 0) {
        const activeAccount = currentAccounts[0];
        instance.setActiveAccount(activeAccount);

        try {
          await instance.acquireTokenSilent({
            ...request,
            account: activeAccount,
          });

          setUserData({
            email: activeAccount.username,
            name: transformCommaSeperatedName(activeAccount.name || ""),
          });
          await fetchOrgRoles(activeAccount);
          setIsLoggedIn(true);
        } catch (error) {
          if (error instanceof InteractionRequiredAuthError) {
            await instance.loginRedirect({
              ...request,
              redirectUri: `${window.location.origin}/auth/callback`,
            });
          } else {
            throw error;
          }
        }
      } else {
        await instance.loginRedirect({
          ...request,
          redirectUri: `${window.location.origin}/auth/callback`,
        });
      }
    },
    [instance, checkRoute, fetchOrgRoles],
  );

  const setLoginStatus = useCallback((val: boolean) => {
    setIsLoggedIn(val);
  }, []);

  const logout = useCallback(async () => {
    try {
      clearAuthCache();
      setOrgRoles([]);
      await instance.logoutRedirect();
    } catch (error) {
      console.error("Logout failed:", error);
    }
  }, [instance]);

  const logoutCallback = useCallback(() => {
    setIsLoggedIn(false);
    setUserData(null);
    setOrgRoles([]);
  }, []);

  // Show loader while MSAL is processing OR while we're initializing auth
  const isLoading = inProgress !== InteractionStatus.None || !isAuthInitialized;

  return (
    <AuthContext.Provider
      value={{
        isLoggedIn,
        isAuthInitialized,
        userData,
        orgRoles,
        setLoginStatus,
        loginMsal,
        logout,
        getToken,
        logoutCallback,
        getApiToken,
        refreshOrgRoles,
      }}
    >
      {isLoading ? (
        <MantineProvider>
          <FullScreenLoader />
        </MantineProvider>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
};
