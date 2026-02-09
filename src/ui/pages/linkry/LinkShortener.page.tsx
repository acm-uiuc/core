import {
  Text,
  Box,
  Title,
  Button,
  Modal,
  Group,
  ButtonGroup,
  Anchor,
  Tabs,
  Loader,
  Stack,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconCancel, IconEdit, IconPlus, IconTrash } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import * as z from "zod/v4";

import { AuthGuard } from "@ui/components/AuthGuard";
import { ManageableOrgsSelector } from "@ui/components/ManageableOrgsSelector";
import { useApi } from "@ui/util/api";
import { AppRoles } from "@common/roles.js";
import { linkRecord, OrgLinkRecord } from "@common/types/linkry.js";
import { getRunEnvironmentConfig } from "@ui/config.js";
import { ResponsiveTable, Column } from "@ui/components/ResponsiveTable";
import { OrganizationId, Organizations } from "@acm-uiuc/js-shared";
import FullScreenLoader from "@ui/components/AuthContext/LoadingScreen";

export type LinkryGetResponse = z.infer<typeof linkRecord>;

export const LinkShortener: React.FC = () => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [ownedLinks, setOwnedLinks] = useState<LinkryGetResponse[]>([]);
  const [delegatedLinks, setDelegatedLinks] = useState<LinkryGetResponse[]>([]);
  const api = useApi("core");
  const [opened, { open, close }] = useDisclosure(false);
  const [deleteLinkCandidate, setDeleteLinkCandidate] =
    useState<LinkryGetResponse | null>(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Org links state
  const [manageableOrgs, setManageableOrgs] = useState<OrganizationId[] | null>(
    null,
  );
  const [hasOrgAccess, setHasOrgAccess] = useState<boolean>(false);
  const orgFromUrl = searchParams.get("org") as OrganizationId | null;
  const [selectedOrg, setSelectedOrg] = useState<OrganizationId | null>(
    orgFromUrl,
  );
  const [orgLinks, setOrgLinks] = useState<OrgLinkRecord[]>([]);
  const [isLoadingOrgLinks, setIsLoadingOrgLinks] = useState<boolean>(false);
  const [deleteOrgLinkCandidate, setDeleteOrgLinkCandidate] =
    useState<OrgLinkRecord | null>(null);
  const [orgDeleteOpened, { open: openOrgDelete, close: closeOrgDelete }] =
    useDisclosure(false);
  const [activeTab, setActiveTab] = useState<string | null>("owned");

  useEffect(() => {
    const getEvents = async () => {
      setIsLoading(true);
      let response;
      try {
        response = await api.get("/api/v1/linkry/redir");
      } finally {
        setIsLoading(false);
      }
      const ownedLinks = response.data.ownedLinks;
      const delegatedLinks = response.data.delegatedLinks;
      setOwnedLinks(ownedLinks);
      setDelegatedLinks(delegatedLinks);
    };
    getEvents();
  }, []);

  // Sync selectedOrg with URL param
  useEffect(() => {
    if (orgFromUrl && manageableOrgs?.includes(orgFromUrl)) {
      setSelectedOrg(orgFromUrl);
    } else if (
      orgFromUrl &&
      manageableOrgs &&
      !manageableOrgs.includes(orgFromUrl)
    ) {
      setSearchParams({});
      setSelectedOrg(null);
    }
  }, [manageableOrgs, orgFromUrl]);

  // Fetch org links when selected org changes
  useEffect(() => {
    if (!selectedOrg) {
      setOrgLinks([]);
      return;
    }
    const fetchOrgLinks = async () => {
      setIsLoadingOrgLinks(true);
      try {
        const response = await api.get(
          `/api/v1/linkry/orgs/${encodeURIComponent(selectedOrg)}/redir`,
        );
        setOrgLinks(response.data);
      } catch (error) {
        console.error("Error fetching org links:", error);
        notifications.show({
          title: "Error loading org links",
          message: `${error}`,
          color: "red",
        });
        setOrgLinks([]);
      } finally {
        setIsLoadingOrgLinks(false);
      }
    };
    fetchOrgLinks();
  }, [selectedOrg]);

  const handleOrgChange = (org: OrganizationId | null) => {
    setSelectedOrg(org);
    if (org) {
      setSearchParams({ org });
    } else {
      setSearchParams({});
    }
  };

  const deleteLink = async (slug: string) => {
    try {
      const encodedSlug = encodeURIComponent(slug);
      setIsLoading(true);
      try {
        await api.delete(`/api/v1/linkry/redir/${encodedSlug}`);
      } finally {
        setIsLoading(false);
      }
      setOwnedLinks((prevLinks) =>
        prevLinks.filter((link) => link.slug !== slug),
      );
      setDelegatedLinks((prevLinks) =>
        prevLinks.filter((link) => link.slug !== slug),
      );
      setIsLoading(false);
      notifications.show({
        title: "Link deleted",
        message: "The link was deleted successfully.",
      });
      close();
    } catch (error) {
      console.error(error);
      notifications.show({
        title: "Error deleting link",
        message: `${error}`,
        color: "red",
      });
    }
  };

  const deleteOrgLink = async (orgId: string, slug: string) => {
    // Strip orgId# prefix to get the bare slug for the API
    const bareSlug = slug.replace(`${orgId}#`, "");
    try {
      setIsLoadingOrgLinks(true);
      try {
        await api.delete(
          `/api/v1/linkry/orgs/${encodeURIComponent(orgId)}/redir/${encodeURIComponent(bareSlug)}`,
        );
      } finally {
        setIsLoadingOrgLinks(false);
      }
      setOrgLinks((prevLinks) =>
        prevLinks.filter((link) => link.slug !== slug),
      );
      notifications.show({
        title: "Org link deleted",
        message: "The link was deleted successfully.",
      });
      closeOrgDelete();
    } catch (error) {
      console.error(error);
      notifications.show({
        title: "Error deleting org link",
        message: `${error}`,
        color: "red",
      });
    }
  };

  const stripOrgPrefix = (slug: string): string => {
    const hashIndex = slug.indexOf("#");
    if (hashIndex !== -1) {
      return slug.substring(hashIndex + 1);
    }
    return slug;
  };

  // Define columns for links table
  const linksColumns: Column<LinkryGetResponse>[] = [
    {
      key: "slug",
      label: "Shortened Link",
      isPrimaryColumn: true,
      render: (link) => (
        <Text
          size="sm"
          style={{
            wordBreak: "break-word",
            overflowWrap: "break-word",
          }}
        >
          {getRunEnvironmentConfig().LinkryPublicUrl}/{link.slug}
        </Text>
      ),
    },
    {
      key: "redirect",
      label: "Redirect URL",
      render: (link) => (
        <Anchor
          href={link.redirect}
          target="_blank"
          size="sm"
          style={{
            wordBreak: "break-word",
            overflowWrap: "break-word",
          }}
        >
          {link.redirect}
        </Anchor>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      hideMobileLabel: true,
      render: (link) => (
        <ButtonGroup>
          <Button
            component="a"
            href={
              link.slug
                ? `/linkry/edit/${encodeURIComponent(link.slug)}?previousPage=${window.location.pathname}`
                : "#"
            }
            onClick={(e) => e.stopPropagation()}
            size="xs"
          >
            <IconEdit size={16} />
          </Button>
          <Button
            color="red"
            onClick={(e) => {
              e.stopPropagation();
              setDeleteLinkCandidate(link);
              open();
            }}
            size="xs"
          >
            <IconTrash size={16} />
          </Button>
        </ButtonGroup>
      ),
    },
  ];

  // Define columns for org links table
  const orgLinksColumns: Column<OrgLinkRecord>[] = [
    {
      key: "slug",
      label: "Shortened Link",
      isPrimaryColumn: true,
      render: (link) => (
        <Text
          size="sm"
          style={{
            wordBreak: "break-word",
            overflowWrap: "break-word",
          }}
        >
          {selectedOrg ? `${Organizations[selectedOrg].shortcode}.` : ""}
          {getRunEnvironmentConfig().LinkryPublicUrl}/
          {stripOrgPrefix(link.slug)}
        </Text>
      ),
    },
    {
      key: "redirect",
      label: "Redirect URL",
      render: (link) => (
        <Anchor
          href={link.redirect}
          target="_blank"
          size="sm"
          style={{
            wordBreak: "break-word",
            overflowWrap: "break-word",
          }}
        >
          {link.redirect}
        </Anchor>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      hideMobileLabel: true,
      render: (link) => (
        <ButtonGroup>
          <Button
            component="a"
            href={
              link.slug && selectedOrg
                ? `/linkry/org/edit/${encodeURIComponent(stripOrgPrefix(link.slug))}?org=${encodeURIComponent(selectedOrg)}`
                : "#"
            }
            onClick={(e) => e.stopPropagation()}
            size="xs"
          >
            <IconEdit size={16} />
          </Button>
          <Button
            color="red"
            onClick={(e) => {
              e.stopPropagation();
              setDeleteOrgLinkCandidate(link);
              openOrgDelete();
            }}
            size="xs"
          >
            <IconTrash size={16} />
          </Button>
        </ButtonGroup>
      ),
    },
  ];

  return (
    <AuthGuard
      resourceDef={{
        service: "core",
        validRoles: [
          AppRoles.LINKS_ADMIN,
          AppRoles.LINKS_MANAGER,
          AppRoles.AT_LEAST_ONE_ORG_MANAGER,
        ],
      }}
    >
      <Box
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          backgroundColor: "rgba(255, 255, 255, 0.7)",
          display: isLoading ? "flex" : "none",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 9999,
        }}
      >
        <Loader size={48} color="blue" />
      </Box>

      {deleteLinkCandidate && (
        <Modal
          opened={opened}
          onClose={() => {
            setDeleteLinkCandidate(null);
            close();
          }}
          title="Confirm Deletion"
        >
          <Text size="sm">
            Are you sure you want to delete the redirect from{" "}
            <code>{deleteLinkCandidate.slug}</code> to{" "}
            <code>{deleteLinkCandidate.redirect}</code>?
          </Text>
          <hr />
          <Group>
            <Button
              leftSection={<IconTrash />}
              color="red"
              onClick={() => {
                if (deleteLinkCandidate?.slug) {
                  deleteLink(deleteLinkCandidate.slug);
                }
              }}
            >
              Delete
            </Button>
            <Button
              leftSection={<IconCancel />}
              onClick={() => {
                setDeleteLinkCandidate(null);
                close();
              }}
            >
              Cancel
            </Button>
          </Group>
        </Modal>
      )}

      {deleteOrgLinkCandidate && (
        <Modal
          opened={orgDeleteOpened}
          onClose={() => {
            setDeleteOrgLinkCandidate(null);
            closeOrgDelete();
          }}
          title="Confirm Deletion"
        >
          <Text size="sm">
            Are you sure you want to delete the redirect from{" "}
            <code>{stripOrgPrefix(deleteOrgLinkCandidate.slug)}</code> to{" "}
            <code>{deleteOrgLinkCandidate.redirect}</code>?
          </Text>
          <hr />
          <Group>
            <Button
              leftSection={<IconTrash />}
              color="red"
              onClick={() => {
                if (deleteOrgLinkCandidate?.slug && selectedOrg) {
                  deleteOrgLink(selectedOrg, deleteOrgLinkCandidate.slug);
                }
              }}
            >
              Delete
            </Button>
            <Button
              leftSection={<IconCancel />}
              onClick={() => {
                setDeleteOrgLinkCandidate(null);
                closeOrgDelete();
              }}
            >
              Cancel
            </Button>
          </Group>
        </Modal>
      )}

      <Stack gap="md">
        <Group justify="space-between" wrap="wrap">
          <Title order={2}>User Links</Title>
          {activeTab === "org" ? (
            selectedOrg && (
              <Button
                leftSection={<IconPlus size={14} />}
                onClick={() =>
                  navigate(
                    `/linkry/org/add?org=${encodeURIComponent(selectedOrg)}`,
                  )
                }
              >
                Add New Org Link
              </Button>
            )
          ) : (
            <Button
              leftSection={<IconPlus size={14} />}
              onClick={() => navigate("/linkry/add")}
            >
              Add New Link
            </Button>
          )}
        </Group>

        <Tabs
          value={activeTab}
          onChange={setActiveTab}
          styles={{
            tab: {
              fontWeight: "bold",
              color: "rgb(34, 139, 230)",
            },
          }}
        >
          <Tabs.List>
            <Tabs.Tab value="owned">My Links</Tabs.Tab>
            <Tabs.Tab value="delegated">Delegated Links</Tabs.Tab>
            {hasOrgAccess && (
              <Tabs.Tab value="org">Organization Links</Tabs.Tab>
            )}
          </Tabs.List>

          <Tabs.Panel value="owned" pt="md">
            {ownedLinks.length > 0 ? (
              <ResponsiveTable
                data={ownedLinks}
                columns={linksColumns}
                keyExtractor={(link) => link.slug}
                testIdPrefix="owned-link-row"
                cardColumns={{ base: 1, sm: 2 }}
              />
            ) : (
              <Text c="dimmed" size="sm" ta="center" py="xl">
                No owned links found. Click "Add New Link" to create one.
              </Text>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="delegated" pt="md">
            {delegatedLinks.length > 0 ? (
              <ResponsiveTable
                data={delegatedLinks}
                columns={linksColumns}
                keyExtractor={(link) => link.slug}
                testIdPrefix="delegated-link-row"
                cardColumns={{ base: 1, sm: 2 }}
              />
            ) : (
              <Text c="dimmed" size="sm" ta="center" py="xl">
                No delegated links found.
              </Text>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="org" pt="md">
            <Stack gap="md">
              <ManageableOrgsSelector
                adminRoles={[AppRoles.ALL_ORG_MANAGER, AppRoles.LINKS_ADMIN]}
                value={selectedOrg}
                onChange={handleOrgChange}
                onOrgsLoaded={(orgs) => {
                  setManageableOrgs(orgs);
                  setHasOrgAccess(orgs.length > 0);
                }}
                label="Select an organization"
                description="Only organizations you have permission to manage are shown."
                placeholder="Select organization"
                maw={400}
              />

              {selectedOrg && (
                <>
                  {isLoadingOrgLinks ? (
                    <FullScreenLoader />
                  ) : orgLinks.length > 0 ? (
                    <ResponsiveTable
                      data={orgLinks}
                      columns={orgLinksColumns}
                      keyExtractor={(link) => link.slug}
                      testIdPrefix="org-link-row"
                      cardColumns={{ base: 1, sm: 2 }}
                    />
                  ) : (
                    <Text c="dimmed" size="sm" ta="center" py="xl">
                      No organization links found. Click "Add New Org Link" to
                      create one.
                    </Text>
                  )}
                </>
              )}
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </AuthGuard>
  );
};
