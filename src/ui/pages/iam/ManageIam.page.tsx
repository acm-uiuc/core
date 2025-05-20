import React, { useState } from "react";
import {
  Title,
  SimpleGrid,
  Container,
  Select,
  Group,
  Stack,
  Text,
} from "@mantine/core";
import { AuthGuard } from "@ui/components/AuthGuard";
import { useApi } from "@ui/util/api";
import { AppRoles } from "@common/roles";
import UserInvitePanel from "./UserInvitePanel";
import GroupMemberManagement from "./GroupMemberManagement";
import { EntraActionResponse, GroupMemberGetResponse } from "@common/types/iam";
import { transformCommaSeperatedName } from "@common/utils";
import { getRunEnvironmentConfig, KnownGroups } from "@ui/config";

const userGroupMappings: KnownGroups = {
  Exec: "Executive Council",
  CommChairs: "Committee Chairs",
  StripeLinkCreators: "Stripe Link Creators",
};

export const ManageIamPage = () => {
  const api = useApi("core");
  const groupMappings = getRunEnvironmentConfig().KnownGroupMappings;
  const groupOptions = Object.entries(groupMappings).map(([key, value]) => ({
    label: userGroupMappings[key as keyof KnownGroups] || key,
    value: `${key}_${value}`, // to ensure that the same group for multiple roles still renders
  }));

  const [selectedGroup, setSelectedGroup] = useState(
    groupOptions[0]?.value || "",
  );

  const handleInviteSubmit = async (emailList: string[]) => {
    try {
      const response = await api.post("/api/v1/iam/inviteUsers", {
        emails: emailList,
      });
      return response.data as EntraActionResponse;
    } catch (error: any) {
      console.error("Failed to invite users:", error);
      return {
        success: [],
        failure: emailList.map((email) => ({
          email,
          message: error.message || "Failed to send invitation",
        })),
      };
    }
  };

  const getGroupMembers = async (selectedGroup: string) => {
    try {
      const response = await api.get(
        `/api/v1/iam/groups/${selectedGroup.split("_")[1]}`,
      );
      const data = response.data as GroupMemberGetResponse;
      const responseMapped = data
        .map((x) => ({
          ...x,
          name: transformCommaSeperatedName(x.name),
        }))
        .sort((a, b) => (a.name > b.name ? 1 : a.name < b.name ? -1 : 0));
      return responseMapped;
    } catch (error) {
      console.error("Failed to get users:", error);
      return [];
    }
  };

  const updateGroupMembers = async (toAdd: string[], toRemove: string[]) => {
    const allMembers = [...toAdd, ...toRemove];
    try {
      const response = await api.patch(
        `/api/v1/iam/groups/${selectedGroup.split("_")[1]}`,
        {
          remove: toRemove,
          add: toAdd,
        },
      );
      return response.data;
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      console.error("Failed to modify group members:", error);
      return {
        success: [],
        failure: allMembers.map((email) => ({
          email,
          message: error.message || "Failed to modify group member",
        })),
      };
    }
  };

  return (
    <AuthGuard
      resourceDef={{
        service: "core",
        validRoles: [AppRoles.IAM_ADMIN, AppRoles.IAM_INVITE_ONLY],
      }}
    >
      <Title order={2}>Manage Authentication</Title>
      <SimpleGrid cols={2}>
        <UserInvitePanel onSubmit={handleInviteSubmit} />
        <AuthGuard
          resourceDef={{ service: "core", validRoles: [AppRoles.IAM_ADMIN] }}
          isAppShell={false}
        >
          <Stack>
            <Text fw={500} mb={4} size="lg">
              Group Management
            </Text>
            <Select
              label="Select Group"
              data={groupOptions}
              value={selectedGroup}
              clearable={false}
              onChange={(value) => value && setSelectedGroup(value)}
              placeholder="Choose a group to manage"
            />
            <GroupMemberManagement
              fetchMembers={() => {
                return getGroupMembers(selectedGroup);
              }}
              updateMembers={updateGroupMembers}
            />
          </Stack>
        </AuthGuard>
      </SimpleGrid>
    </AuthGuard>
  );
};
