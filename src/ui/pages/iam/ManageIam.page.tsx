import React from 'react';
import { Title, SimpleGrid, Container } from '@mantine/core';
import { AuthGuard } from '@ui/components/AuthGuard';
import { useApi } from '@ui/util/api';
import { AppRoles } from '@common/roles';
import UserInvitePanel from './UserInvitePanel';
import GroupMemberManagement from './GroupMemberManagement';
import { execCouncilGroupId } from '@common/config';
import {
  EntraActionResponse,
  GroupMemberGetResponse,
  GroupModificationPatchRequest,
} from '@common/types/iam';

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

  const getExecMembers = async () => {
    try {
      const response = await api.get(`/api/v1/iam/groups/${execCouncilGroupId}`);
      return response.data as GroupMemberGetResponse;
    } catch (error: any) {
      console.error('Failed to get users:', error);
      return [];
    }
  };

  const updateExecMembers = async (toAdd: string[], toRemove: string[]) => {
    const allMembers = toAdd.concat(toRemove);
    try {
      const response = await api.patch(`/api/v1/iam/groups/${execCouncilGroupId}`, {
        remove: toRemove,
        add: toAdd,
      } as GroupModificationPatchRequest);
      return response.data as EntraActionResponse;
    } catch (error: any) {
      console.error('Failed to get users:', error);
      return {
        success: [],
        failure: allMembers.map((email) => ({
          email,
          message: error.message || 'Failed to modify group member',
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
        <AuthGuard
          resourceDef={{ service: 'core', validRoles: [AppRoles.IAM_ADMIN] }}
          isAppShell={false}
        >
          <GroupMemberManagement fetchMembers={getExecMembers} updateMembers={updateExecMembers} />
        </AuthGuard>
        {/* For future panels, make sure to add an auth guard if not every IAM role can see it. */}
      </SimpleGrid>
    </AuthGuard>
  );
};
