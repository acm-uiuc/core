import React from 'react';
import { Title, SimpleGrid, Container } from '@mantine/core';
import { AuthGuard } from '@ui/components/AuthGuard';
import { useApi } from '@ui/util/api';
import { AppRoles } from '@common/roles';
import UserInvitePanel from './UserInvitePanel';

export const ManageIamPage = () => {
  const api = useApi('core');

  const handleInviteSubmit = async (emailList: string[]) => {
    try {
      const response = await api.post('/api/v1/iam/inviteUsers', {
        emails: emailList,
      });
      return response.data;
    } catch (error: any) {
      console.error('Failed to invite users:', error);
      return {
        success: [],
        failure: emailList.map((email) => ({
          email,
          message: error.message || 'Failed to send invitation',
        })),
      };
    }
  };

  return (
    <AuthGuard
      resourceDef={{ service: 'core', validRoles: [AppRoles.IAM_ADMIN, AppRoles.IAM_INVITE_ONLY] }}
    >
      <Title order={2}>Manage Authentication</Title>
      <SimpleGrid cols={2}>
        <UserInvitePanel onSubmit={handleInviteSubmit} />
        {/* For future panels, make sure to add an auth guard if not every IAM role can see it. */}
      </SimpleGrid>
    </AuthGuard>
  );
};
