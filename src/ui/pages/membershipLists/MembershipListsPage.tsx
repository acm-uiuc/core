import { useState, useEffect } from "react";
import { Title, Stack, Container, Grid } from "@mantine/core";
import { AuthGuard } from "@ui/components/AuthGuard";
import { useApi } from "@ui/util/api";
import { AppRoles } from "@common/roles";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle } from "@tabler/icons-react";
import ExternalMemberListManagement from "./ExternalMemberListManagement";
import FullScreenLoader from "@ui/components/AuthContext/LoadingScreen";
import InternalMembershipQuery from "./InternalMembershipQuery";
import { AxiosError } from "axios";

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

  const queryInternalMembership = async (netIds: string[]) => {
    try {
      const result = await api.post<{
        members: string[];
        notMembers: string[];
      }>(`/api/v2/membership/verifyBatchOfMembers`, netIds);
      return result.data;
    } catch (error: any) {
      console.error("Failed to check internal membership:", error);
      notifications.show({
        title: "Failed to query membership list.",
        message: "Please try again or contact support.",
        color: "red",
        icon: <IconAlertCircle size={16} />,
      });
      throw error;
    }
  };

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
    <Container fluid m="lg">
      <Grid>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <AuthGuard
            resourceDef={{
              service: "core",
              validRoles: [AppRoles.VIEW_INTERNAL_MEMBERSHIP_LIST],
            }}
          >
            <Stack>
              <Title order={2}>Query ACM Paid Membership List</Title>
              <InternalMembershipQuery
                queryFunction={queryInternalMembership}
              />
            </Stack>
          </AuthGuard>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <AuthGuard
            resourceDef={{
              service: "core",
              validRoles: [
                AppRoles.MANAGE_EXTERNAL_MEMBERSHIP_LIST,
                AppRoles.VIEW_EXTERNAL_MEMBERSHIP_LIST,
              ],
            }}
          >
            <Stack>
              <Title order={2}>Manage External Membership Lists</Title>
              <ExternalMemberListManagement
                fetchMembers={fetchMembers}
                updateMembers={handlePatchMembers}
                validLists={validLists}
                onListCreated={handleListCreated}
              />
            </Stack>
          </AuthGuard>
        </Grid.Col>
      </Grid>
    </Container>
  );
};
