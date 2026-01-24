import React, { useEffect, useState } from "react";
import {
  Text,
  Group,
  Box,
  LoadingOverlay,
  Alert,
  Stack,
  Paper,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconMoodSmileBeam, IconUser } from "@tabler/icons-react";

export interface UserProfileData {
  userPrincipalName: string;
  displayName?: string;
  givenName?: string;
  surname?: string;
  mail?: string;
}

interface ViewProfileComponentProps {
  getProfile: () => Promise<UserProfileData>;
  firstTime: boolean;
}

export const ViewProfileComponent: React.FC<ViewProfileComponentProps> = ({
  getProfile,
  firstTime,
}) => {
  const [userProfile, setUserProfile] = useState<UserProfileData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const profile = await getProfile();
      setUserProfile(profile);
    } catch (e) {
      console.error(e);
      setUserProfile(null);
      notifications.show({
        color: "red",
        message: "Failed to load user profile",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, [getProfile]);

  if (userProfile === undefined) {
    return <LoadingOverlay visible data-testid="profile-loading" />;
  }

  const ProfileField = ({
    label,
    value,
  }: {
    label: string;
    value: string | null | undefined;
  }) => (
    <Box>
      <Text size="sm" c="dimmed" fw={500}>
        {label}
      </Text>
      <Text
        size="md"
        data-testid={`profile-${label.toLowerCase().replace(" ", "-")}`}
      >
        {value || "—"}
      </Text>
    </Box>
  );

  return (
    <Stack gap="md">
      {firstTime && (
        <Alert
          icon={<IconMoodSmileBeam />}
          title="Welcome to the ACM @ UIUC Management Portal"
          color="yellow"
        >
          Your profile is incomplete. Please visit{" "}
          <a target="_blank" rel="noreferrer" href="https://acm.gg/sync">
            the sync page
          </a>{" "}
          to sync information from your Illinois NetID.
        </Alert>
      )}

      <Stack gap="sm">
        <ProfileField label="First Name" value={userProfile?.givenName} />
        <ProfileField label="Last Name" value={userProfile?.surname} />
        <ProfileField label="Email" value={userProfile?.mail} />
      </Stack>
      <Text size="md" c="dimmed" mb="xl">
        This information must match the information from your Illinois NetID. If
        it does not, please sync your profile information on{" "}
        <a target="_blank" rel="noreferrer" href="https://acm.gg/sync">
          the sync page
        </a>
        .
      </Text>
    </Stack>
  );
};
