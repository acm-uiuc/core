import { Card, Text, Title } from '@mantine/core';
import React, { ReactNode, useEffect, useState } from 'react';

import { AcmAppShell, AcmAppShellProps } from '@ui/components/AppShell';
import FullScreenLoader from '@ui/components/AuthContext/LoadingScreen';
import { getRunEnvironmentConfig, ValidService } from '@ui/config';
import { useApi } from '@ui/util/api';
import { AppRoles } from '@common/roles';

export const CACHE_KEY_PREFIX = 'auth_response_cache_';
const CACHE_DURATION = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

type CacheData = {
  data: any; // Just the JSON response data
  timestamp: number;
};

export type ResourceDefinition = {
  service: ValidService;
  validRoles: AppRoles[];
};

const getAuthCacheKey = (service: ValidService, route: string) =>
  `${CACHE_KEY_PREFIX}${service}_${route}`;

export const getCachedResponse = async (
  service: ValidService,
  route: string
): Promise<CacheData | null> => {
  const cacheKey = getAuthCacheKey(service, route);
  const item = (await navigator.locks.request(
    `lock_${cacheKey}`,
    { mode: 'shared' },
    async (lock) => {
      const cached = sessionStorage.getItem(getAuthCacheKey(service, route));
      if (!cached) return null;

      try {
        const data = JSON.parse(cached) as CacheData;
        const now = Date.now();

        if (now - data.timestamp <= CACHE_DURATION) {
          return data;
        }
        // Clear expired cache
        sessionStorage.removeItem(getAuthCacheKey(service, route));
      } catch (e) {
        console.error('Error parsing auth cache:', e);
        sessionStorage.removeItem(getAuthCacheKey(service, route));
      }
      return null;
    }
  )) as CacheData | null;
  return item;
};

export const setCachedResponse = async (service: ValidService, route: string, data: any) => {
  const cacheData: CacheData = {
    data,
    timestamp: Date.now(),
  };
  const cacheKey = getAuthCacheKey(service, route);
  await navigator.locks.request(`lock_${cacheKey}`, { mode: 'exclusive' }, async (lock) => {
    sessionStorage.setItem(cacheKey, JSON.stringify(cacheData));
  });
};

// Function to clear auth cache for all services
export const clearAuthCache = () => {
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith(CACHE_KEY_PREFIX)) {
      sessionStorage.removeItem(key);
    }
  }
};

export const AuthGuard: React.FC<
  {
    resourceDef: ResourceDefinition;
    children: ReactNode;
    isAppShell?: boolean;
    loadingSkeleton?: ReactNode;
  } & AcmAppShellProps
> = ({ resourceDef, children, isAppShell = true, loadingSkeleton, ...appShellProps }) => {
  const { service, validRoles } = resourceDef;
  const { baseEndpoint, authCheckRoute, friendlyName } =
    getRunEnvironmentConfig().ServiceConfiguration[service];
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[] | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const api = useApi(service);

  useEffect(() => {
    async function getAuth() {
      await navigator.locks.request(
        `lock_authGuard_loader`,
        { mode: 'exclusive' },
        async (lock) => {
          try {
            if (!authCheckRoute) {
              setIsAuthenticated(true);
              return;
            }
            if (validRoles.length === 0) {
              setIsAuthenticated(true);
              return;
            }

            // Check for cached response first
            setIsLoading(true);
            const cachedData = await getCachedResponse(service, authCheckRoute);
            if (cachedData !== null) {
              const userRoles = cachedData.data.roles;
              let authenticated = false;
              for (const item of userRoles) {
                if (validRoles.indexOf(item) !== -1) {
                  authenticated = true;
                  break;
                }
              }
              setUsername(cachedData.data.username);
              setRoles(cachedData.data.roles);
              setIsAuthenticated(authenticated);
              setIsLoading(false);
              return;
            }

            // If no cache, make the API call
            const result = await api.get(authCheckRoute);
            // Cache just the response data
            await setCachedResponse(service, authCheckRoute, result.data);

            const userRoles = result.data.roles;
            let authenticated = false;
            for (const item of userRoles) {
              if (validRoles.indexOf(item) !== -1) {
                authenticated = true;
                break;
              }
            }
            setIsAuthenticated(authenticated);
            setRoles(result.data.roles);
            setUsername(result.data.username);
            setIsLoading(false);
          } catch (e) {
            setIsAuthenticated(false);
            setIsLoading(false);
            console.error(e);
          }
        }
      );
    }
    getAuth();
  }, [baseEndpoint, authCheckRoute, service]);
  if (isLoading && loadingSkeleton) {
    return loadingSkeleton;
  }
  if (isAuthenticated === null) {
    if (isAppShell) {
      return <FullScreenLoader />;
    }
    return null;
  }

  if (!isAuthenticated) {
    if (isAppShell) {
      return (
        <AcmAppShell>
          <Title>Unauthorized</Title>
          <Text>
            You have not been granted access to this module. Please fill out the{' '}
            <a href="https://go.acm.illinois.edu/access_request">access request form</a> to request
            access to this module.
          </Text>
          <Card withBorder>
            <Title order={3} mb="md">
              Diagnostic Details
            </Title>
            <ul>
              <li>Endpoint: {baseEndpoint}</li>
              <li>
                Service: {friendlyName} (<code>{service}</code>)
              </li>
              <li>User: {username}</li>
              <li>Roles: {roles ? roles.join(', ') : <code>none</code>}</li>
              <li>
                Time: {new Date().toDateString()} {new Date().toLocaleTimeString()}
              </li>
            </ul>
          </Card>
        </AcmAppShell>
      );
    }
    return null;
  }

  if (isAppShell) {
    return <AcmAppShell {...appShellProps}>{children}</AcmAppShell>;
  }

  return <>{children}</>;
};
