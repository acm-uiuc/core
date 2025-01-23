import React from 'react';
import { Title, SimpleGrid, Container } from '@mantine/core';
import { AuthGuard } from '@ui/components/AuthGuard';
import { useApi } from '@ui/util/api';
import { AppRoles } from '@common/roles';
import UserInvitePanel from './UserInvitePanel';
import GroupMemberManagement from './GroupMemberManagement';
import {
  EntraActionResponse,
  GroupMappingCreatePostRequest,
  GroupMemberGetResponse,
  GroupModificationPatchRequest,
  OkResponse,
  RolesGetResponse,
} from '@common/types/iam';
import { getRunEnvironmentConfig } from '@ui/config';
import RoleManagement from './RoleManagement';

export const ManageIamPage = () => {
  const api = useApi('core');
  const groupId = getRunEnvironmentConfig().KnownGroupMappings.Exec;

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
      const response = await api.get(`/api/v1/iam/groups/${groupId}`);
      return response.data as GroupMemberGetResponse;
    } catch (error: any) {
      console.error('Failed to get users:', error);
      return [];
    }
  };

  const updateExecMembers = async (toAdd: string[], toRemove: string[]) => {
    const allMembers = toAdd.concat(toRemove);
    try {
      const response = await api.patch(`/api/v1/iam/groups/${groupId}`, {
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

  const fetchGroupPermissions = async (groupId: string) => {
    const response = await api.get(`/api/v1/iam/groups/${groupId}/roles`);
    return response.data as RolesGetResponse;
  };

  const fetchGroups = async () => {
    // TODO: implement this.
    return [{ groupId: '0' }, { groupId: '940e4f9e-6891-4e28-9e29-148798495cdb' }];
  };

  const setGroupPermissions = async (groupId: string, roles: AppRoles[] | ['all']) => {
    try {
      const response = await api.post(`/api/v1/iam/groups/${groupId}/roles`, {
        roles,
      } as GroupMappingCreatePostRequest);
      return response.data as OkResponse;
    } catch (e) {
      console.error(`Failed to set group permissions: ${e}`);
      throw e;
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
        <AuthGuard
          resourceDef={{ service: 'core', validRoles: [AppRoles.IAM_ADMIN] }}
          isAppShell={false}
        >
          <RoleManagement
            fetchGroupPermissions={fetchGroupPermissions}
            setGroupPermissions={setGroupPermissions}
            fetchGroups={fetchGroups}
          />
        </AuthGuard>
      </SimpleGrid>
    </AuthGuard>
  );
};
