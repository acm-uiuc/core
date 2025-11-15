import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  ReactNode,
} from "react";
import { Avatar, Group, Text, Skeleton, Badge } from "@mantine/core";
import { useApi } from "@ui/util/api";
import { BatchResolveUserInfoResponse } from "@common/types/user";
import { useAuth } from "../AuthContext";

// Types
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

// Basic email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface UserResolverContextType {
  resolveUser: (email: string) => UserData | undefined;
  requestUser: (email: string) => void;
  isResolving: (email: string) => boolean;
}

// Context
const UserResolverContext = createContext<UserResolverContextType | null>(null);

// Provider Props
interface UserResolverProviderProps {
  children: ReactNode;
  batchDelay?: number;
}

interface UserDataResponse {
  name?: string;
}

// Sentinel value to indicate we've checked and there's no name
const NO_NAME_FOUND = Symbol("NO_NAME_FOUND");

export function UserResolverProvider({
  children,
  batchDelay = 50,
}: UserResolverProviderProps) {
  const api = useApi("core");
  const [userCache, setUserCache] = useState<
    Record<string, string | typeof NO_NAME_FOUND>
  >({});
  const pendingRequests = useRef<Set<string>>(new Set());
  const batchTimeout = useRef<NodeJS.Timeout | null>(null);

  const fetchUsers = async (emailsToFetch: string[]) => {
    const response = await api.post<BatchResolveUserInfoResponse>(
      "/api/v1/users/batchResolveInfo",
      {
        emails: emailsToFetch,
      },
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
      setUserCache((prev) => ({ ...prev, ...results }));
    } catch (error) {
      console.error("Failed to fetch users:", error);
      const failedCache: Record<string, typeof NO_NAME_FOUND> = {};
      emailsToFetch.forEach((email) => {
        failedCache[email] = NO_NAME_FOUND;
      });
      setUserCache((prev) => ({ ...prev, ...failedCache }));
    }
  };

  const requestUser = (email: string) => {
    // Skip if already cached (including NO_NAME_FOUND sentinel)
    if (email in userCache) {
      return;
    }

    // Validate email format - if invalid, mark as NO_NAME_FOUND immediately
    if (!EMAIL_REGEX.test(email)) {
      setUserCache((prev) => ({ ...prev, [email]: NO_NAME_FOUND }));
      return;
    }

    pendingRequests.current.add(email);

    // Clear existing timeout and set new one
    if (batchTimeout.current) {
      clearTimeout(batchTimeout.current);
    }

    batchTimeout.current = setTimeout(() => {
      executeBatch();
    }, batchDelay);
  };

  const isResolving = (email: string): boolean => {
    return !(email in userCache);
  };

  const resolveUser = (email: string): UserData | undefined => {
    const cached = userCache[email];
    if (!cached || cached === NO_NAME_FOUND) {
      return undefined;
    }
    return { email, name: cached };
  };

  return (
    <UserResolverContext.Provider
      value={{ resolveUser, requestUser, isResolving }}
    >
      {children}
    </UserResolverContext.Provider>
  );
}

// Hook
function useUserResolver() {
  const context = useContext(UserResolverContext);
  if (!context) {
    throw new Error("useUserResolver must be used within UserResolverProvider");
  }
  return context;
}

// Component Props
interface NameOptionalUserCardProps {
  email: string;
  name?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  fallback?: (email: string) => ReactNode;
}

// Component
export function NameOptionalUserCard({
  name: providedName,
  email,
  size = "sm",
  fallback,
}: NameOptionalUserCardProps) {
  const { resolveUser, requestUser, isResolving } = useUserResolver();
  const [resolvedUser, setResolvedUser] = useState<UserData | undefined>();
  const { userData } = useAuth();

  // Check if this is actually an email
  const isValidEmail = EMAIL_REGEX.test(email);

  useEffect(() => {
    // If name is already provided or not a valid email, don't resolve
    if (providedName || !isValidEmail) {
      return;
    }

    // Request the user (will be batched)
    requestUser(email);

    // Set up polling to check if user has been resolved
    const interval = setInterval(() => {
      const user = resolveUser(email);
      if (user) {
        setResolvedUser(user);
        clearInterval(interval);
      }
    }, 10);

    return () => clearInterval(interval);
  }, [email, providedName, isValidEmail, resolveUser, requestUser]);

  // If not a valid email, render fallback or default text
  if (!isValidEmail) {
    return fallback ? <>{fallback(email)}</> : <Text fz="sm">{email}</Text>;
  }

  const displayName = providedName || resolvedUser?.name || email;
  const isLoading = !providedName && isResolving(email);

  const isCurrentUser = !!userData && userData.email === email;

  return (
    <Group gap="sm">
      {isLoading ? (
        <Skeleton circle height={AVATAR_SIZES[size]} />
      ) : (
        <Avatar name={displayName} color="initials" size={size} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Group gap="xs" align="center">
          <Text fz="sm" fw={500}>
            {isLoading ? <Skeleton height={16} width="60%" /> : displayName}
          </Text>

          {isCurrentUser && !isLoading && (
            <Badge size="sm" variant="light">
              You
            </Badge>
          )}
        </Group>
        <Text fz="xs" c="dimmed">
          {isLoading ? <Skeleton height={12} width="80%" /> : email}
        </Text>
      </div>
    </Group>
  );
}
