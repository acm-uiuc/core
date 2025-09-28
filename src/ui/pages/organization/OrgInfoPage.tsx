import { useState, useEffect } from "react";
import { Title, Stack, Container, Grid } from "@mantine/core";
import { AuthGuard, getUserRoles } from "@ui/components/AuthGuard";
import { useApi } from "@ui/util/api";
import { AppRoles } from "@common/roles";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle } from "@tabler/icons-react";
import FullScreenLoader from "@ui/components/AuthContext/LoadingScreen";
import { AxiosError } from "axios";
import { AllOrganizationList } from "@acm-uiuc/js-shared";
import { useAuth } from "@ui/components/AuthContext";

type AcmOrg = (typeof AllOrganizationList)[number];

export const OrgInfoPage = () => {
  const api = useApi("core");
  const { orgRoles } = useAuth();
  const [manageableOrgs, setManagableOrgs] = useState<AcmOrg[] | null>(null);

  const getCurrentInformation = async (org: AcmOrg) => {
    try {
      const result = await api.post<{
        members: string[];
        notMembers: string[];
      }>(`/api/v1/organization/${org}`);
      return result.data;
    } catch (error: any) {
      console.error("Failed to check get org info:", error);
      notifications.show({
        title: `Failed to get information for ${org}.`,
        message: "Please try again or contact support.",
        color: "red",
        icon: <IconAlertCircle size={16} />,
      });
      throw error;
    }
  };

  useEffect(() => {
    (async () => {
      const appRoles = await getUserRoles("core");
      if (appRoles?.includes(AppRoles.ALL_ORG_MANAGER)) {
        setManagableOrgs(AllOrganizationList);
        return;
      }
      setManagableOrgs(
        orgRoles.filter((x) => x.role === "LEAD").map((x) => x.org),
      );
    })();
  }, [orgRoles]);

  if (!manageableOrgs) {
    return <FullScreenLoader />;
  }
  if (manageableOrgs.length === 0) {
    // Need to show access denied.
    return (
      <AuthGuard
        resourceDef={{
          service: "core",
          validRoles: [AppRoles.AT_LEAST_ONE_ORG_MANAGER],
        }}
      >
        {null}
      </AuthGuard>
    );
  }
  return (
    <Container fluid m="lg">
      <Grid>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <AuthGuard
            resourceDef={{
              service: "core",
              validRoles: [],
            }}
          >
            <Stack>
              <Title order={2}>Manage Organization Info</Title>
            </Stack>
          </AuthGuard>
        </Grid.Col>
      </Grid>
    </Container>
  );
};
