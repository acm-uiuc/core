import { useState, useEffect } from "react";
import { Title, Stack, Container, Select } from "@mantine/core";
import {
  AuthGuard,
  getUserRoles,
  getCoreOrgRoles,
} from "@ui/components/AuthGuard";
import { useApi } from "@ui/util/api";
import { AppRoles } from "@common/roles";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle } from "@tabler/icons-react";
import FullScreenLoader from "@ui/components/AuthContext/LoadingScreen";
import {
  AllOrganizationIdList,
  OrganizationId,
  OrganizationName,
  Organizations,
} from "@acm-uiuc/js-shared";
import { ManageOrganizationForm } from "./ManageOrganizationForm";
import {
  LeadEntry,
  ORG_DATA_CACHED_DURATION,
  setOrganizationMetaBody,
} from "@common/types/organizations";
import * as z from "zod/v4";
import { useSearchParams } from "react-router-dom";

type OrganizationData = z.infer<typeof setOrganizationMetaBody>;

export const OrgInfoPage = () => {
  const api = useApi("core");
  const [searchParams, setSearchParams] = useSearchParams();
  const [manageableOrgs, setManagableOrgs] = useState<OrganizationId[] | null>(
    null,
  );

  // Get org from URL query parameter
  const orgFromUrl = searchParams.get("org") as OrganizationId | null;
  const [selectedOrg, setSelectedOrg] = useState<OrganizationId | null>(
    orgFromUrl,
  );

  const getOrganizationData = async (
    org: OrganizationId,
  ): Promise<OrganizationData> => {
    try {
      const response = await api.get(
        `/api/v1/organizations/${org}?ts=${Date.now()}`,
      );
      return response.data;
    } catch (error: any) {
      console.error("Failed to get org info:", error);
      notifications.show({
        title: `Failed to get information for ${org}.`,
        message: "Please try again or contact support.",
        color: "red",
        icon: <IconAlertCircle size={16} />,
      });
      throw error;
    }
  };

  const updateOrganizationData = async (
    org: OrganizationName,
    data: OrganizationData,
  ): Promise<void> => {
    try {
      await api.post(`/api/v1/organizations/${org}/meta`, data);
      notifications.show({
        title: `${org} updated`,
        message: `Changes may take up to ${ORG_DATA_CACHED_DURATION / 60} minutes to reflect to all users.`,
        color: "green",
      });
    } catch (error: any) {
      console.error("Failed to update org info:", error);

      // Extract error message if available
      const errorMessage =
        error.response?.data?.message || "Please try again or contact support.";

      notifications.show({
        title: `Failed to update information for ${org}.`,
        message: errorMessage,
        color: "red",
        icon: <IconAlertCircle size={16} />,
      });
      throw error;
    }
  };
  const updateLeads = async (
    org: OrganizationName,
    toAdd: LeadEntry[],
    toRemove: string[],
  ): Promise<void> => {
    try {
      await api.patch(`/api/v1/organizations/${org}/leads`, {
        add: toAdd,
        remove: toRemove,
      });
      notifications.show({
        title: `${org} leads updated`,
        message: `Changes may take up to ${ORG_DATA_CACHED_DURATION / 60} minutes to reflect to all users.`,
        color: "green",
      });
    } catch (error: any) {
      console.error("Failed to update org leads:", error);
      const errorMessage =
        error.response?.data?.message || "Please try again or contact support.";

      notifications.show({
        title: `Failed to update leads for ${org}.`,
        message: errorMessage,
        color: "red",
        icon: <IconAlertCircle size={16} />,
      });
      throw error;
    }
  };
  useEffect(() => {
    (async () => {
      const appRoles = await getUserRoles("core");
      const orgRoles = await getCoreOrgRoles();
      if (appRoles === null || orgRoles === null) {
        return;
      }
      if (appRoles.includes(AppRoles.ALL_ORG_MANAGER)) {
        setManagableOrgs([...AllOrganizationIdList]);
        return;
      }
      setManagableOrgs(
        orgRoles.filter((x) => x.role === "LEAD").map((x) => x.org),
      );
    })();
  }, []);

  // Update URL when selected org changes
  const handleOrgChange = (org: OrganizationId | null) => {
    setSelectedOrg(org);
    if (org) {
      setSearchParams({ org });
    } else {
      setSearchParams({});
    }
  };

  // Initialize selected org from URL on mount
  useEffect(() => {
    if (orgFromUrl && manageableOrgs?.includes(orgFromUrl)) {
      setSelectedOrg(orgFromUrl);
    } else if (
      orgFromUrl &&
      manageableOrgs &&
      !manageableOrgs.includes(orgFromUrl)
    ) {
      // Clear invalid org from URL
      setSearchParams({});
      setSelectedOrg(null);
    }
  }, [manageableOrgs, orgFromUrl]);

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
    <Container size="lg" py="md">
      <AuthGuard
        resourceDef={{
          service: "core",
          validRoles: [
            AppRoles.AT_LEAST_ONE_ORG_MANAGER,
            AppRoles.ALL_ORG_MANAGER,
          ],
        }}
      >
        <Stack gap="lg">
          <div>
            <Title order={2}>Manage Organization Info</Title>
            <Select
              label="Select an organization"
              description="Only organizations you have permission to manage are shown."
              placeholder="Select organization"
              data={manageableOrgs.map((x) => ({
                value: x,
                label: Organizations[x].name,
              }))}
              value={selectedOrg}
              onChange={(i) => handleOrgChange(i as OrganizationId)}
              mt="md"
              searchable
              maw={400}
            />
          </div>

          {selectedOrg && (
            <ManageOrganizationForm
              organizationId={selectedOrg}
              getOrganizationData={(i) =>
                getOrganizationData(i as OrganizationId)
              }
              updateOrganizationData={(data) =>
                updateOrganizationData(selectedOrg, data)
              }
              updateLeads={(toAdd, toRemove) =>
                updateLeads(selectedOrg, toAdd, toRemove)
              }
            />
          )}
        </Stack>
      </AuthGuard>
    </Container>
  );
};
