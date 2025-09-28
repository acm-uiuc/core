import {
  AuthenticationResult,
  InteractionRequiredAuthError,
  InteractionStatus,
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
} from "react";

import {
  CACHE_KEY_PREFIX,
  setCachedResponse,
  getCachedResponse,
} from "../AuthGuard/index.js";

import FullScreenLoader from "./LoadingScreen.js";

import { getRunEnvironmentConfig, ValidServices } from "@ui/config.js";
import { transformCommaSeperatedName } from "@common/utils.js";
import { useApi } from "@ui/util/api.js";
import { OrgRoleDefinition } from "@common/roles.js";

interface AuthContextDataWrapper {
  isLoggedIn: boolean;
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

export const clearAuthCache = () => {
  sessionStorage.clear();
};

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const { instance, inProgress, accounts } = useMsal();
  const [userData, setUserData] = useState<AuthContextData | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [orgRoles, setOrgRoles] = useState<OrgRoleDefinition[]>([]);
  const checkRoute =
    getRunEnvironmentConfig().ServiceConfiguration.core.authCheckRoute;
  if (!checkRoute) {
    throw new Error("no check route found!");
  }

  const api = useApi("core");

  const navigate = (path: string) => {
    window.location.href = path;
  };

  // Function to fetch and update org roles
  const fetchOrgRoles = useCallback(async () => {
    try {
      // Check cache first
      const cachedData = await getCachedResponse("core", checkRoute);
      if (cachedData?.data?.orgRoles) {
        setOrgRoles(cachedData.data.orgRoles || []);
        return cachedData.data.orgRoles;
      }

      // Fetch fresh data if not in cache
      const result = await api.get(checkRoute);
      await setCachedResponse("core", checkRoute, result.data);

      if (result.data?.orgRoles) {
        setOrgRoles(result.data.orgRoles || []);
        return result.data.orgRoles;
      }

      return [];
    } catch (error) {
      console.error("Failed to fetch org roles:", error);
      return [];
    }
  }, [api, checkRoute]);

  // Refresh org roles on demand
  const refreshOrgRoles = useCallback(async () => {
    // Clear cache to force fresh fetch
    const cacheKey = `${CACHE_KEY_PREFIX}core_${checkRoute}`;
    sessionStorage.removeItem(cacheKey);
    await fetchOrgRoles();
  }, [checkRoute, fetchOrgRoles]);

  useEffect(() => {
    const handleRedirect = async () => {
      const response = await instance.handleRedirectPromise();
      if (response) {
        await handleMsalResponse(response);
      } else if (accounts.length > 0) {
        setUserData({
          email: accounts[0].username,
          name: transformCommaSeperatedName(accounts[0].name || ""),
        });
        setIsLoggedIn(true);
        // Fetch org roles when user is already logged in
        await fetchOrgRoles();
      }
    };

    if (inProgress === InteractionStatus.None) {
      handleRedirect();
    }
  }, [inProgress, accounts, instance]);

  const handleMsalResponse = useCallback(
    async (response: AuthenticationResult) => {
      if (response?.account) {
        if (!accounts.length) {
          // If accounts array is empty, try silent authentication
          instance
            .ssoSilent({
              scopes: ["openid", "profile", "email"],
              loginHint: response.account.username,
            })
            .then(async (silentResponse) => {
              if (silentResponse?.account?.name) {
                setUserData({
                  email: accounts[0].username,
                  name: transformCommaSeperatedName(accounts[0].name || ""),
                });

                // Fetch and cache auth data including orgRoles
                const result = await api.get(checkRoute);
                await setCachedResponse("core", checkRoute, result.data);

                if (result.data?.orgRoles) {
                  setOrgRoles(result.data.orgRoles || []);
                }

                setIsLoggedIn(true);
              }
            })
            .catch(console.error);
          return;
        }
        setUserData({
          email: accounts[0].username,
          name: transformCommaSeperatedName(accounts[0].name || ""),
        });

        // Fetch org roles after successful authentication
        await fetchOrgRoles();
        setIsLoggedIn(true);
      }
    },
    [accounts, instance, api, checkRoute, fetchOrgRoles],
  );

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
          scopes: [scope], // Adjust scopes as needed,
          resource: apiId,
        };
        const tokenResponse = await instance.acquireTokenSilent(silentRequest);
        return tokenResponse.accessToken;
      }
      throw new Error("More than one account found, cannot proceed.");
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
          scopes: [".default"], // Adjust scopes as needed
        };
        const tokenResponse = await instance.acquireTokenSilent(silentRequest);
        return tokenResponse.accessToken;
      }
      throw new Error("More than one account found, cannot proceed.");
    } catch (error) {
      console.error("Silent token acquisition failed.", error);
      if (error instanceof InteractionRequiredAuthError) {
        // Fallback to interaction when silent token acquisition fails
        try {
          const interactiveRequest = {
            scopes: [".default"], // Adjust scopes as needed
            redirectUri: "/auth/callback", // Redirect URI after login
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

      const accounts = instance.getAllAccounts();
      const request = {
        scopes: ["openid", "profile", "email"],
        state: returnTo,
      };

      if (accounts.length > 0) {
        instance.setActiveAccount(accounts[0]);
        try {
          await instance.acquireTokenSilent({
            ...request,
            account: accounts[0],
          });

          // Fetch and cache auth data including orgRoles
          const result = await api.get(checkRoute);
          await setCachedResponse("core", checkRoute, result.data);

          if (result.data?.orgRoles) {
            setOrgRoles(result.data.orgRoles || []);
          }

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
    [instance, checkRoute, api],
  );

  const setLoginStatus = useCallback((val: boolean) => {
    setIsLoggedIn(val);
  }, []);

  const logout = useCallback(async () => {
    try {
      clearAuthCache();
      setOrgRoles([]); // Clear org roles on logout
      await instance.logoutRedirect();
    } catch (error) {
      console.error("Logout failed:", error);
    }
  }, [instance]);

  const logoutCallback = useCallback(() => {
    setIsLoggedIn(false);
    setUserData(null);
    setOrgRoles([]); // Clear org roles on logout callback
  }, []);

  return (
    <AuthContext.Provider
      value={{
        isLoggedIn,
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
      {inProgress !== InteractionStatus.None ? (
        <MantineProvider>
          <FullScreenLoader />
        </MantineProvider>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
};
