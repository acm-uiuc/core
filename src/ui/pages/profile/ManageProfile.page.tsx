import React from 'react';
import { Title } from '@mantine/core';
import { AuthGuard } from '@ui/components/AuthGuard';
import { useApi } from '@ui/util/api';
import { UserProfileData } from '@common/types/msGraphApi';
import { ManageProfileComponent } from './ManageProfileComponent';

export const ManageProfilePage: React.FC = () => {
  const api = useApi('msGraphApi');

  const getProfile = async () => {
    return (await api.get('/v1.0/me')).data as UserProfileData;
  };

  const setProfile = async (data: UserProfileData) => {
    return (await api.patch('/v1.0/me', data)).data;
  };

  return (
    <AuthGuard resourceDef={{ service: 'msGraphApi', validRoles: [] }} showSidebar={true}>
      <Title>Edit Profile</Title>
      <ManageProfileComponent getProfile={getProfile} setProfile={setProfile} />
    </AuthGuard>
  );
};
