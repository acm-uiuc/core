import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  ReactNode,
} from "react";
import { Avatar, Group, Text, Skeleton, Badge } from "@mantine/core";
import { useApi } from "@ui/util/api";
import { BatchResolveUserInfoResponse } from "@common/types/user";
import { useAuth } from "../AuthContext";

interface UserData {
  email: string;
  name?: string;
}

const AVATAR_SIZES = {
  xs: 16,
  sm: 26,
  md: 38,
  lg: 56,
  xl: 84,
} as const;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface UserResolverContextType {
  resolveUser: (email: string) => UserData | undefined;
  registerCard: (email: string, element: Element) => void;
  unregisterCard: (element: Element) => void;
  isResolving: (email: string) => boolean;
  resolutionDisabled: boolean;
  cacheVersion: number;
}

const UserResolverContext = createContext<UserResolverContextType | null>(null);

interface UserResolverProviderProps {
  children: ReactNode;
  batchDelay?: number;
  resolutionDisabled?: boolean;
  /** Number of additional cards to prefetch beyond the one entering the viewport */
  prefetchAhead?: number;
}

const NO_NAME_FOUND = Symbol("NO_NAME_FOUND");

export function UserResolverProvider({
  children,
  batchDelay = 50,
  resolutionDisabled = false,
  prefetchAhead = 10,
}: UserResolverProviderProps) {
  const api = useApi("core");
  const [userCache, setUserCache] = useState<
    Record<string, string | typeof NO_NAME_FOUND>
  >({});
  const [cacheVersion, setCacheVersion] = useState(0);
  const pendingRequests = useRef<Set<string>>(new Set());
  const batchTimeout = useRef<NodeJS.Timeout | null>(null);

  // Refs so observer callback always sees latest values without recreating the observer
  const userCacheRef = useRef(userCache);
  userCacheRef.current = userCache;
  const resolutionDisabledRef = useRef(resolutionDisabled);
  resolutionDisabledRef.current = resolutionDisabled;
  const prefetchAheadRef = useRef(prefetchAhead);
  prefetchAheadRef.current = prefetchAhead;

  // element -> email, and ordered email list matching visual registration order
  const elementToEmail = useRef<Map<Element, string>>(new Map());
  const orderedEmails = useRef<string[]>([]);
  const intersectionObserver = useRef<IntersectionObserver | null>(null);
  const requestUserRef = useRef<(email: string) => void>(() => {});

  const fetchUsers = async (emailsToFetch: string[]) => {
    const response = await api.post<BatchResolveUserInfoResponse>(
      "/api/v1/users/batchResolveInfo",
      { emails: emailsToFetch },
    );
    const emailToName: Record<string, string | typeof NO_NAME_FOUND> = {};
    for (const email of emailsToFetch) {
      const userData = response.data[email];
      if (userData?.firstName || userData?.lastName) {
        const nameParts = [userData.firstName, userData.lastName].filter(
          Boolean,
        );
        emailToName[email] = nameParts.join(" ");
      } else {
        emailToName[email] = NO_NAME_FOUND;
      }
    }
    return emailToName;
  };

  const executeBatch = async () => {
    if (pendingRequests.current.size === 0) {
      return;
    }
    const emailsToFetch = Array.from(pendingRequests.current);
    pendingRequests.current.clear();
    try {
      const results = await fetchUsers(emailsToFetch);
      setUserCache((prev) => {
        setCacheVersion((v) => v + 1);
        return { ...prev, ...results };
      });
    } catch (error) {
      console.error("Failed to fetch users:", error);
      const failedCache: Record<string, typeof NO_NAME_FOUND> = {};
      emailsToFetch.forEach((email) => {
        failedCache[email] = NO_NAME_FOUND;
      });
      setUserCache((prev) => {
        setCacheVersion((v) => v + 1);
        return { ...prev, ...failedCache };
      });
    }
  };

  const requestUser = (email: string) => {
    if (resolutionDisabledRef.current) {
      setUserCache((prev) => {
        setCacheVersion((v) => v + 1);
        return { ...prev, [email]: NO_NAME_FOUND };
      });
      return;
    }
    if (email in userCacheRef.current) {
      return;
    }
    if (!EMAIL_REGEX.test(email)) {
      setUserCache((prev) => {
        setCacheVersion((v) => v + 1);
        return { ...prev, [email]: NO_NAME_FOUND };
      });
      return;
    }
    pendingRequests.current.add(email);
    if (batchTimeout.current) {
      clearTimeout(batchTimeout.current);
    }
    batchTimeout.current = setTimeout(executeBatch, batchDelay);
  };
  requestUserRef.current = requestUser;

  // Lazily create the observer on first registerCard call so it exists before any card's useEffect runs
  const getOrCreateObserver = useCallback(() => {
    if (intersectionObserver.current) {
      return intersectionObserver.current;
    }
    intersectionObserver.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const email = elementToEmail.current.get(entry.target);
            if (email) {
              const idx = orderedEmails.current.indexOf(email);
              const batch =
                idx === -1
                  ? [email]
                  : orderedEmails.current.slice(
                      idx,
                      idx + prefetchAheadRef.current + 1,
                    );
              batch.forEach((e) => requestUserRef.current(e));
              intersectionObserver.current?.unobserve(entry.target);
            }
          }
        }
      },
      { rootMargin: "0px" },
    );
    return intersectionObserver.current;
  }, []);

  useEffect(() => {
    return () => {
      intersectionObserver.current?.disconnect();
    };
  }, []);

  const registerCard = useCallback(
    (email: string, element: Element) => {
      if (email in userCacheRef.current) {
        return;
      }
      elementToEmail.current.set(element, email);
      if (!orderedEmails.current.includes(email)) {
        orderedEmails.current.push(email);
      }
      getOrCreateObserver().observe(element);
    },
    [getOrCreateObserver],
  );

  const unregisterCard = useCallback((element: Element) => {
    elementToEmail.current.delete(element);
    intersectionObserver.current?.unobserve(element);
  }, []);

  const resolveUser = useCallback(
    (email: string): UserData | undefined => {
      const cached = userCache[email];
      if (!cached || cached === NO_NAME_FOUND) {
        return undefined;
      }
      return { email, name: cached };
    },
    [userCache],
  );

  const isResolving = useCallback(
    (email: string): boolean => !(email in userCache),
    [userCache],
  );

  return (
    <UserResolverContext.Provider
      value={{
        resolveUser,
        registerCard,
        unregisterCard,
        isResolving,
        resolutionDisabled,
        cacheVersion,
      }}
    >
      {children}
    </UserResolverContext.Provider>
  );
}

function useUserResolver() {
  const context = useContext(UserResolverContext);
  if (!context) {
    throw new Error("useUserResolver must be used within UserResolverProvider");
  }
  return context;
}

interface NameOptionalUserCardProps {
  email: string;
  name?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  fallback?: (email: string) => ReactNode;
  resolutionDisabled?: boolean;
}

export function NameOptionalUserCard({
  name: providedName,
  email,
  size = "sm",
  fallback,
  resolutionDisabled: resolutionDisabledProp,
}: NameOptionalUserCardProps) {
  const {
    resolveUser,
    registerCard,
    unregisterCard,
    isResolving,
    resolutionDisabled: contextResolutionDisabled,
    cacheVersion,
  } = useUserResolver();

  const resolutionDisabled =
    typeof resolutionDisabledProp === "boolean"
      ? resolutionDisabledProp
      : contextResolutionDisabled;

  const [resolvedUser, setResolvedUser] = useState<UserData | undefined>();
  const { userData } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);

  const isValidEmail = EMAIL_REGEX.test(email);

  // Register with the provider's shared observer; it handles in-view + next N prefetch
  useEffect(() => {
    if (
      resolutionDisabled ||
      providedName ||
      !isValidEmail ||
      !containerRef.current
    ) {
      return;
    }
    const element = containerRef.current;
    registerCard(email, element);
    return () => unregisterCard(element);
  }, [
    email,
    providedName,
    isValidEmail,
    resolutionDisabled,
    registerCard,
    unregisterCard,
  ]);

  // Read from cache whenever it updates (independent of visibility)
  useEffect(() => {
    if (resolutionDisabled || providedName || !isValidEmail) {
      return;
    }
    const user = resolveUser(email);
    if (user) {
      setResolvedUser(user);
    }
  }, [
    email,
    providedName,
    isValidEmail,
    resolutionDisabled,
    cacheVersion,
    resolveUser,
  ]);

  if (!isValidEmail) {
    return fallback ? <>{fallback(email)}</> : <Text fz="sm">{email}</Text>;
  }

  const displayName = providedName || resolvedUser?.name || email;
  const isLoading = !resolutionDisabled && !providedName && isResolving(email);
  const isCurrentUser = !!userData && userData.email === email;

  return (
    <Group ref={containerRef} gap="sm" wrap="nowrap">
      {isLoading ? (
        <Skeleton circle height={AVATAR_SIZES[size]} />
      ) : (
        <Avatar name={displayName} color="initials" size={size} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Group gap="xs" align="center" wrap="nowrap">
          <Text fz="sm" fw={500} component="span">
            {isLoading ? <Skeleton height={16} width="60%" /> : displayName}
          </Text>
          {isCurrentUser && !isLoading && (
            <Badge size="sm" variant="light">
              You
            </Badge>
          )}
        </Group>
        <Text fz="xs" c="dimmed" component="span">
          {isLoading ? <Skeleton height={12} width="80%" /> : email}
        </Text>
      </div>
    </Group>
  );
}
