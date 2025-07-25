import {
  Text,
  Box,
  Title,
  Button,
  Table,
  Modal,
  Group,
  Transition,
  ButtonGroup,
  Anchor,
  Badge,
  Tabs,
  Loader,
  useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconCancel, IconEdit, IconPlus, IconTrash } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as z from "zod/v4";

import { AuthGuard } from "@ui/components/AuthGuard";
import { useApi } from "@ui/util/api";
import { AppRoles } from "@common/roles.js";
import { linkRecord } from "@common/types/linkry.js";
import { getRunEnvironmentConfig } from "@ui/config.js";

const wrapTextStyle: React.CSSProperties = {
  wordWrap: "break-word",
  overflowWrap: "break-word" as const,
  whiteSpace: "normal",
};

export type LinkryGetResponse = z.infer<typeof linkRecord>;

export const LinkShortener: React.FC = () => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [ownedLinks, setOwnedLinks] = useState<LinkryGetResponse[]>([]);
  const [delegatedLinks, setDelegatedLinks] = useState<LinkryGetResponse[]>([]);
  const api = useApi("core");
  const [opened, { open, close }] = useDisclosure(false);
  const [showPrevious, { toggle: togglePrevious }] = useDisclosure(false); // Changed default to false
  const [deleteLinkCandidate, setDeleteLinkCandidate] =
    useState<LinkryGetResponse | null>(null);
  const navigate = useNavigate();
  const { colorScheme } = useMantineColorScheme();

  const renderTableRow = (link: LinkryGetResponse, index: number) => {
    const shouldShow = true;

    return (
      <Transition
        mounted={shouldShow}
        transition="fade"
        duration={10000}
        timingFunction="ease"
      >
        {(styles) => (
          <tr
            style={{
              ...styles,
              display: shouldShow ? "table-row" : "none",
              backgroundColor:
                colorScheme === "dark"
                  ? index % 2 === 0
                    ? "#333333"
                    : "#444444"
                  : index % 2 === 0
                    ? "#f0f8ff"
                    : "#ffffff",
            }}
          >
            <Table.Td style={wrapTextStyle}>
              {getRunEnvironmentConfig().LinkryPublicUrl}/{link.slug}
            </Table.Td>
            <Table.Td style={wrapTextStyle}>
              <Anchor href={link.redirect} target="_blank" size="sm">
                {link.redirect}
              </Anchor>
            </Table.Td>
            {/* <Table.Td style={wrapTextStyle}>{dayjs(link.createdAt).format('MMM D YYYY hh:mm')}</Table.Td>
            <Table.Td style={wrapTextStyle}>{dayjs(link.updatedAt).format('MMM D YYYY hh:mm')}</Table.Td> */}
            <Table.Td
              style={{
                textAlign: "center",
                justifyContent: "rightcenter",
                alignItems: "center",
              }}
            >
              <ButtonGroup>
                {/* <Button component="a" href={`/linkry/edit/${link.id}`}>
                 Edit
                </Button> */}
                <Button
                  component="a"
                  href={
                    link.slug
                      ? `/linkry/edit/${encodeURIComponent(link.slug)}?previousPage=${window.location.pathname}`
                      : "#"
                  }
                >
                  <IconEdit size={16} />
                </Button>
                <Button
                  color="red"
                  onClick={() => {
                    setDeleteLinkCandidate(link);
                    open();
                  }}
                >
                  <IconTrash size={16} />
                </Button>
              </ButtonGroup>
            </Table.Td>
          </tr>
        )}
      </Transition>
    );
  };

  const renderDelegatedLinks = (link: LinkryGetResponse, index: number) => {
    const shouldShow = true;

    return (
      <Transition
        mounted={shouldShow}
        transition="fade"
        duration={400}
        timingFunction="ease"
      >
        {(styles) => (
          <tr
            style={{
              ...styles,
              display: shouldShow ? "table-row" : "none",
              backgroundColor: index % 2 === 0 ? "#f0f8ff" : "#ffffff",
            }}
          >
            <Table.Td style={wrapTextStyle}>
              <Anchor
                href={`http://localhost:8080/api/v1/linkry/redir/${link.slug}`}
                target="_blank"
              >
                {" "}
                {/* Currently set to localhost for local testing purposes */}
                https://go.acm.illinois.edu/{link.slug}
              </Anchor>
            </Table.Td>
            <Table.Td style={wrapTextStyle}>
              <Anchor
                href={`/api/v1/linkry/redir/${link.slug}`}
                target="_blank"
              >
                {link.redirect}
              </Anchor>
            </Table.Td>
            <Table.Td style={wrapTextStyle}>
              {link.access.map((group, index) => (
                <Badge
                  key={index}
                  color="#999898"
                  radius="sm"
                  style={{ marginRight: "2px", marginBottom: "2px" }}
                >
                  {group.trim()} {/* Trim any extra whitespace */}
                </Badge>
              ))}
            </Table.Td>
            {/* <Table.Td style={wrapTextStyle}>{dayjs(link.createdAt).format('MMM D YYYY hh:mm')}</Table.Td>
            <Table.Td style={wrapTextStyle}>{dayjs(link.updatedAt).format('MMM D YYYY hh:mm')}</Table.Td> */}
            <Table.Td
              style={{
                textAlign: "center",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <ButtonGroup>
                {/* <Button component="a" href={`/linkry/edit/${link.id}`}>
                 Edit
                </Button> */}
                <Button
                  component="a"
                  href={
                    link.slug
                      ? `/linkry/edit/${encodeURIComponent(link.slug)}?previousPage=${window.location.pathname}`
                      : "#"
                  }
                >
                  <IconEdit size={16} />
                </Button>
                <Button
                  color="red"
                  onClick={() => {
                    setDeleteLinkCandidate(link);
                    open();
                  }}
                >
                  <IconTrash size={16} />
                </Button>
              </ButtonGroup>
            </Table.Td>
          </tr>
        )}
      </Transition>
    );
  };

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
        title: "Error deleting event",
        message: `${error}`,
        color: "red",
      });
    }
  };

  return (
    <AuthGuard
      resourceDef={{
        service: "core",
        validRoles: [AppRoles.LINKS_ADMIN, AppRoles.LINKS_MANAGER],
      }}
    >
      <Box
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          backgroundColor: "rgba(255, 255, 255, 0.7)", // semi-transparent background
          display: isLoading ? "flex" : "none",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 9999, // make sure it’s on top
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
              color="Red"
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
                setDeleteLinkCandidate(null); // Clear the delete candidate
                close(); // Close the modal
              }}
            >
              Cancel
            </Button>
          </Group>
        </Modal>
      )}
      <Title order={2} mb="md">
        User Links
      </Title>

      <div
        style={{
          display: "flex",
          columnGap: "1vw",
          verticalAlign: "middle",
          marginBottom: "20px",
        }}
      >
        <Button
          leftSection={<IconPlus size={14} />}
          onClick={() => {
            navigate("/linkry/add");
          }}
        >
          Add New Link
        </Button>
      </div>

      <Tabs
        defaultValue="owned"
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
        </Tabs.List>

        <Tabs.Panel value="owned" pt="xs">
          <div style={{ width: "100%", overflowX: "auto" }}>
            <Table style={{ tableLayout: "fixed", width: "100%" }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Shortened Link</Table.Th>
                  <Table.Th>Redirect URL</Table.Th>
                  <Table.Th>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>{ownedLinks.map(renderTableRow)}</Table.Tbody>
            </Table>
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="delegated" pt="xs">
          <div style={{ width: "100%", overflowX: "auto" }}>
            <Table style={{ tableLayout: "fixed", width: "100%" }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Shortened Link</Table.Th>
                  <Table.Th>Redirect URL</Table.Th>
                  <Table.Th>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>{delegatedLinks.map(renderTableRow)}</Table.Tbody>
            </Table>
          </div>
        </Tabs.Panel>
      </Tabs>
    </AuthGuard>
  );
};
