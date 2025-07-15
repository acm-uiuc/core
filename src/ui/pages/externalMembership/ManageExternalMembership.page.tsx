import { useState, useEffect } from "react";
import {
  Title,
  SimpleGrid,
  Select,
  Stack,
  Text,
  LoadingOverlay,
  Container,
} from "@mantine/core";
import { AuthGuard } from "@ui/components/AuthGuard";
import { useApi } from "@ui/util/api";
import { AppRoles } from "@common/roles";
import {
  EntraActionResponse,
  GroupMemberGetResponse,
  GroupGetResponse,
} from "@common/types/iam";
import { transformCommaSeperatedName } from "@common/utils";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle } from "@tabler/icons-react";
import ExternalMemberListManagement from "./ExternalMemberListManagement";
import FullScreenLoader from "@ui/components/AuthContext/LoadingScreen";

export const ManageExternalMembershipPage = () => {
  const api = useApi("core");
  const [validLists, setValidLists] = useState<string[] | null>(null);

  useEffect(() => {
    const fetchLists = async () => {
      try {
        const response = await api.get<string[]>(
          "/api/v1/membership/externalList",
        );
        setValidLists(response.data);
      } catch (error) {
        console.error("Failed to fetch list of lists:", error);
        notifications.show({
          title: "Failed to get lists.",
          message: "Please try again or contact support.",
          color: "red",
          icon: <IconAlertCircle size={16} />,
        });
        throw error;
      }
    };

    fetchLists();
  }, [api]);

  const handleListCreated = (listId: string) => {
    setValidLists((prevLists) => [...(prevLists || []), listId]);
  };

  const fetchMembers = async (listId: string) => {
    try {
      const response = await api.get<string[]>(
        `/api/v1/membership/externalList/${listId}`,
      );
      return response.data;
    } catch (error: any) {
      console.error("Failed to get members:", error);
      notifications.show({
        title: `Failed to get list "${listId}".`,
        message: "Please try again or contact support.",
        color: "red",
        icon: <IconAlertCircle size={16} />,
      });
      throw error;
    }
  };

  const handlePatchMembers = async (
    listId: string,
    add: string[],
    remove: string[],
  ) => {
    try {
      await api.patch(`/api/v1/membership/externalList/${listId}`, {
        add,
        remove,
      });
    } catch (error: any) {
      console.error("Failed to invite users:", error);
      notifications.show({
        title: `Failed to modify list "${listId}".`,
        message: "Please try again or contact support.",
        color: "red",
        icon: <IconAlertCircle size={16} />,
      });
      throw error;
    }
  };
  if (!validLists) {
    return <FullScreenLoader />;
  }
  return (
    <AuthGuard
      resourceDef={{
        service: "core",
        validRoles: [
          AppRoles.MANAGE_EXTERNAL_MEMBERSHIP_LIST,
          AppRoles.VIEW_EXTERNAL_MEMBERSHIP_LIST,
        ],
      }}
    >
      <Container>
        <Title order={2}>Manage External Membership Lists</Title>
        <ExternalMemberListManagement
          fetchMembers={fetchMembers}
          updateMembers={handlePatchMembers}
          validLists={validLists}
          onListCreated={handleListCreated}
        />
      </Container>
    </AuthGuard>
  );
};
