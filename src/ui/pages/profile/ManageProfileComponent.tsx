import React, { useEffect, useState } from 'react';
import { TextInput, Button, Group, Box, LoadingOverlay, Alert } from '@mantine/core';
import { UserProfileData } from '@common/types/msGraphApi';
import { notifications } from '@mantine/notifications';
import { useNavigate } from 'react-router-dom';
import { IconMoodSmileBeam } from '@tabler/icons-react';

interface ManageProfileComponentProps {
  getProfile: () => Promise<UserProfileData>;
  setProfile: (data: UserProfileData) => Promise<any>;
  firstTime: boolean;
}

export const ManageProfileComponent: React.FC<ManageProfileComponentProps> = ({
  getProfile,
  setProfile,
  firstTime,
}) => {
  const navigate = useNavigate();
  const [userProfile, setUserProfile] = useState<undefined | null | UserProfileData>(undefined);
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
        color: 'red',
        message: 'Failed to load user profile',
      });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    fetchProfile();
  }, [getProfile]);

  const handleSubmit = async () => {
    if (!userProfile) return;
    setLoading(true);
    try {
      await setProfile(userProfile);
      notifications.show({
        color: 'green',
        title: 'Profile updated successfully',
        message: 'Changes may take some time to reflect.',
      });
    } catch (e) {
      console.error(e);
      notifications.show({
        color: 'red',
        message: 'Failed to update profile',
      });
    } finally {
      setLoading(false);
    }
  };

  if (userProfile === undefined) {
    return <LoadingOverlay visible={true} data-testid="profile-loading" />;
  }

  return (
    <>
      {firstTime && (
        <Alert
          icon={<IconMoodSmileBeam />}
          title="Welcome to the ACM @ UIUC Management Portal"
          color="yellow"
        >
          Your profile is incomplete. Please provide us with the information below and click Save.
        </Alert>
      )}
      <Box mx="auto" p="md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <TextInput
            label="Full Name"
            value={userProfile?.displayName || ''}
            onChange={(e) =>
              setUserProfile((prev) => prev && { ...prev, displayName: e.target.value })
            }
            placeholder={userProfile?.displayName}
            required
            data-testid="edit-displayName"
          />
          <TextInput
            label="First Name"
            value={userProfile?.givenName || ''}
            onChange={(e) =>
              setUserProfile((prev) => prev && { ...prev, givenName: e.target.value })
            }
            placeholder={userProfile?.givenName}
            required
            data-testid="edit-firstName"
          />
          <TextInput
            label="Last Name"
            value={userProfile?.surname || ''}
            onChange={(e) => setUserProfile((prev) => prev && { ...prev, surname: e.target.value })}
            placeholder={userProfile?.surname}
            required
            data-testid="edit-lastName"
          />
          <TextInput
            label="Email"
            value={userProfile?.mail || ''}
            onChange={(e) => setUserProfile((prev) => prev && { ...prev, mail: e.target.value })}
            placeholder={userProfile?.mail}
            required
            disabled
            data-testid="edit-email"
          />

          <TextInput
            label="Discord Username"
            value={userProfile?.discordUsername || ''}
            onChange={(e) =>
              setUserProfile((prev) => prev && { ...prev, discordUsername: e.target.value })
            }
            data-testid="edit-discordUsername"
          />

          <Group mt="md">
            <Button type="submit" loading={loading} disabled={loading || !userProfile}>
              Save
            </Button>
          </Group>
        </form>
      </Box>
    </>
  );
};
