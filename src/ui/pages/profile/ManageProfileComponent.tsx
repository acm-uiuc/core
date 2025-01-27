import React, { useEffect, useState } from 'react';
import { Title, SimpleGrid, Container } from '@mantine/core';
import { AuthGuard } from '@ui/components/AuthGuard';
import { useApi } from '@ui/util/api';
import { AppRoles } from '@common/roles';
import { getRunEnvironmentConfig } from '@ui/config';
import { UserProfileData } from '@common/types/msGraphApi';

interface ManageProfileComponentProps {
  getProfile: () => Promise<UserProfileData>;
  setProfile: (data: UserProfileData) => Promise<any>;
}

export const ManageProfileComponent: React.FC<ManageProfileComponentProps> = ({
  getProfile,
  setProfile,
}) => {
  const [userProfile, setUserProfile] = useState<undefined | null | UserProfileData>(undefined);
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        setUserProfile(await getProfile());
      } catch (e) {
        console.error(e);
        setUserProfile(null);
      }
    };
    fetchProfile();
  }, [getProfile]);
  return null;
};
