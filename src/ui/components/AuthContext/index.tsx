import {
  AuthenticationResult,
  InteractionRequiredAuthError,
  InteractionStatus,
} from '@azure/msal-browser';
import { useMsal } from '@azure/msal-react';
import { MantineProvider } from '@mantine/core';
import React, {
  createContext,
  ReactNode,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';

import { CACHE_KEY_PREFIX } from '../AuthGuard/index.js';

import FullScreenLoader from './LoadingScreen.js';

import { getRunEnvironmentConfig, ValidServices } from '@ui/config.js';

interface AuthContextDataWrapper {
  isLoggedIn: boolean;
  userData: AuthContextData | null;
  loginMsal: CallableFunction;
  logout: CallableFunction;
  getToken: CallableFunction;
  logoutCallback: CallableFunction;
  getApiToken: CallableFunction;
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
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith(CACHE_KEY_PREFIX)) {
      sessionStorage.removeItem(key);
    }
  }
};

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const { instance, inProgress, accounts } = useMsal();

  const [userData, setUserData] = useState<AuthContextData | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);

  const navigate = (path: string) => {
    window.location.href = path;
  };

  useEffect(() => {
    const handleRedirect = async () => {
      const response = await instance.handleRedirectPromise();
      if (response) {
        handleMsalResponse(response);
      } else if (accounts.length > 0) {
        // User is already logged in, set the state
        const [lastName, firstName] = accounts[0].name?.split(',') || [];
        setUserData({
          email: accounts[0].username,
          name: `${firstName} ${lastName}`,
        });
        setIsLoggedIn(true);
      }
    };

    if (inProgress === InteractionStatus.None) {
      handleRedirect();
    }
  }, [inProgress, accounts, instance]);

  const handleMsalResponse = useCallback(
    (response: AuthenticationResult) => {
      if (response?.account) {
        if (!accounts.length) {
          // If accounts array is empty, try silent authentication
          instance
            .ssoSilent({
              scopes: ['openid', 'profile', 'email'],
              loginHint: response.account.username,
            })
            .then((silentResponse) => {
              if (silentResponse?.account?.name) {
                const [lastName, firstName] = silentResponse.account.name.split(',');
                setUserData({
                  email: silentResponse.account.username,
                  name: `${firstName} ${lastName}`,
                });
                setIsLoggedIn(true);
              }
            })
            .catch(console.error);
          return;
        }

        // Use response.account instead of accounts[0]
        const [lastName, firstName] = response.account.name?.split(',') || [];
        setUserData({
          email: response.account.username,
          name: `${firstName} ${lastName}`,
        });
        setIsLoggedIn(true);
      }
    },
    [accounts, instance]
  );
  const getApiToken = useCallback(
    async (service: ValidServices) => {
      if (!userData) {
        return null;
      }
      const scope = getRunEnvironmentConfig().ServiceConfiguration[service].loginScope;
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
      throw new Error('More than one account found, cannot proceed.');
    },
    [userData, instance]
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
          scopes: ['.default'], // Adjust scopes as needed
        };
        const tokenResponse = await instance.acquireTokenSilent(silentRequest);
        return tokenResponse.accessToken;
      }
      throw new Error('More than one account found, cannot proceed.');
    } catch (error) {
      console.error('Silent token acquisition failed.', error);
      if (error instanceof InteractionRequiredAuthError) {
        // Fallback to interaction when silent token acquisition fails
        try {
          const interactiveRequest = {
            scopes: ['.default'], // Adjust scopes as needed
            redirectUri: '/auth/callback', // Redirect URI after login
          };
          const tokenResponse: any = await instance.acquireTokenRedirect(interactiveRequest);
          return tokenResponse.accessToken;
        } catch (interactiveError) {
          console.error('Interactive token acquisition failed.', interactiveError);
          throw interactiveError;
        }
      } else {
        throw error;
      }
    }
  }, [userData, instance]);

  const loginMsal = useCallback(
    async (returnTo: string) => {
      const accountsLocal = instance.getAllAccounts();
      if (accountsLocal.length > 0) {
        instance.setActiveAccount(accountsLocal[0]);
        setIsLoggedIn(true);
      } else {
        await instance.loginRedirect({
          scopes: ['openid', 'profile', 'email'],
          state: returnTo,
          redirectUri: `${window.location.origin}/auth/callback`,
        });
      }
    },
    [instance]
  );

  const logout = useCallback(async () => {
    try {
      clearAuthCache();
      await instance.logoutRedirect();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  }, [instance, userData]);
  const logoutCallback = () => {
    setIsLoggedIn(false);
    setUserData(null);
  };
  return (
    <AuthContext.Provider
      value={{ isLoggedIn, userData, loginMsal, logout, getToken, logoutCallback, getApiToken }}
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
