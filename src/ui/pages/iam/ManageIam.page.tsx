import { useState, useEffect } from "react";
import { Title, SimpleGrid, Select, Stack, Text } from "@mantine/core";
import { AuthGuard } from "@ui/components/AuthGuard";
import { useApi } from "@ui/util/api";
import { AppRoles } from "@common/roles";
import UserInvitePanel from "./UserInvitePanel";
import GroupMemberManagement from "./GroupMemberManagement";
import {
  EntraActionResponse,
  GroupMemberGetResponse,
  GroupGetResponse,
} from "@common/types/iam";
import { transformCommaSeperatedName } from "@common/utils";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle } from "@tabler/icons-react";

export const ManageIamPage = () => {
  const api = useApi("core");
  const [groupOptions, setGroupOptions] = useState<
    { label: string; value: string }[]
  >([]);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  // Fetch groups from the API on component mount
  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const response = await api.get<GroupGetResponse>("/api/v1/iam/groups");
        const options = response.data
          .map(({ id, displayName }) => ({
            label: displayName,
            value: id,
          }))
          .sort((a, b) => a.label.localeCompare(b.label)); // Sort alphabetically
        setGroupOptions(options);
      } catch (error) {
        console.error("Failed to fetch groups:", error);
        notifications.show({
          title: "Failed to get groups.",
          message: "Please try again or contact support.",
          color: "red",
          icon: <IconAlertCircle size={16} />,
        });
      }
    };

    fetchGroups();
  }, [api]);

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

  const getGroupMembers = async (groupId: string | null) => {
    if (!groupId) {
      return [];
    }
    try {
      const response = await api.get(`/api/v1/iam/groups/${groupId}`);
      const data = response.data as GroupMemberGetResponse;
      return data
        .map((x) => ({
          ...x,
          name: transformCommaSeperatedName(x.name),
        }))
        .sort((a, b) => (a.name > b.name ? 1 : a.name < b.name ? -1 : 0));
    } catch (error) {
      console.error("Failed to get users:", error);
      return [];
    }
  };

  const updateGroupMembers = async (toAdd: string[], toRemove: string[]) => {
    if (!selectedGroup) {
      const errorMessage = "No group selected for update.";
      console.error(errorMessage);
      return {
        success: [],
        failure: [...toAdd, ...toRemove].map((email) => ({
          email,
          message: errorMessage,
        })),
      };
    }

    try {
      const response = await api.patch(`/api/v1/iam/groups/${selectedGroup}`, {
        remove: toRemove,
        add: toAdd,
      });
      return response.data;
    } catch (error: any) {
      console.error("Failed to modify group members:", error);
      return {
        success: [],
        failure: [...toAdd, ...toRemove].map((email) => ({
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
      <Title order={2} mb="md">
        Manage Authentication
      </Title>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <Stack>
          <Text fw={500} mb={4} size="lg">
            Add Users to Entra ID Tenant
          </Text>
          <UserInvitePanel onSubmit={handleInviteSubmit} />
        </Stack>
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
              searchable
              data={groupOptions}
              value={selectedGroup}
              clearable={false}
              onChange={(value) => setSelectedGroup(value)}
              placeholder={
                groupOptions.length > 0
                  ? "Choose a group to manage"
                  : "Loading groups..."
              }
              disabled={groupOptions.length === 0}
            />
            {selectedGroup && (
              <GroupMemberManagement
                key={selectedGroup}
                fetchMembers={() => getGroupMembers(selectedGroup)}
                updateMembers={updateGroupMembers}
              />
            )}
          </Stack>
        </AuthGuard>
      </SimpleGrid>
    </AuthGuard>
  );
};
