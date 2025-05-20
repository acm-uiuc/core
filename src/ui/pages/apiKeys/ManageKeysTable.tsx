import {
  Badge,
  Button,
  Center,
  Checkbox,
  Code,
  CopyButton,
  Group,
  List,
  Modal,
  MultiSelect,
  Skeleton,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import {
  IconAlertCircle,
  IconEye,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import {
  apiKeyAllowedRoles,
  ApiKeyMaskedEntry,
  ApiKeyPostBody,
} from "@common/types/apiKey";
import { useAuth } from "@ui/components/AuthContext";
import { notifications } from "@mantine/notifications";
import pluralize from "pluralize";
import dayjs from "dayjs";
import { AppRoles } from "@common/roles";
import { BlurredTextDisplay } from "../../components/BlurredTextDisplay";

const HumanFriendlyDate = ({ date }: { date: number }) => {
  return (
    <Text size="sm">{dayjs(date * 1000).format("MMMM D, YYYY h:mm A")}</Text>
  );
};

interface OrgApiKeyTableProps {
  getApiKeys: () => Promise<ApiKeyMaskedEntry[]>;
  deleteApiKeys: (ids: string[]) => Promise<void>;
  createApiKey: (data: ApiKeyPostBody) => Promise<{ apiKey: string }>;
}

export const OrgApiKeyTable: React.FC<OrgApiKeyTableProps> = ({
  getApiKeys,
  deleteApiKeys,
  createApiKey,
}) => {
  const [apiKeys, setApiKeys] = useState<ApiKeyMaskedEntry[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  // New state for delete confirmation modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [idsToDelete, setIdsToDelete] = useState<string[]>([]);
  // New state for view permissions modal
  const [viewPermissionsModalOpen, setViewPermissionsModalOpen] =
    useState(false);
  const [selectedKeyForPermissions, setSelectedKeyForPermissions] =
    useState<ApiKeyMaskedEntry | null>(null);

  const { userData } = useAuth();

  const fetchKeys = async () => {
    try {
      setIsLoading(true);
      const data = await getApiKeys();
      setApiKeys(data);
    } catch (e) {
      notifications.show({
        title: "Error loading API keys",
        message: "Unable to fetch API keys. Try again later.",
        color: "red",
        icon: <IconAlertCircle size={16} />,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (ids: string[]) => {
    try {
      await deleteApiKeys(ids);
      notifications.show({
        title: "Deleted",
        message: `${pluralize("API key", ids.length, true)} deleted successfully.`,
        color: "green",
      });
      setSelected([]);
      fetchKeys();
    } catch (e) {
      notifications.show({
        title: "Delete failed",
        message: "Something went wrong while deleting the API keys.",
        color: "red",
        icon: <IconAlertCircle size={16} />,
      });
    } finally {
      // Close the modal after deletion attempt
      setDeleteModalOpen(false);
    }
  };

  // New function to open the delete confirmation modal
  const confirmDelete = (ids: string[]) => {
    setIdsToDelete(ids);
    setDeleteModalOpen(true);
  };

  // New function to open the view permissions modal
  const openViewPermissionsModal = (key: ApiKeyMaskedEntry) => {
    setSelectedKeyForPermissions(key);
    setViewPermissionsModalOpen(true);
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleCreate = async (form: ApiKeyPostBody) => {
    try {
      const res = await createApiKey(form);
      setCreatedKey(res.apiKey);
      setCreateModalOpen(false);
      await fetchKeys();
    } catch (e) {
      notifications.show({
        title: "Create failed",
        message: "Unable to create API key.",
        color: "red",
      });
    }
  };

  const createRow = (entry: ApiKeyMaskedEntry) => (
    <Table.Tr key={entry.keyId}>
      <Table.Td>
        <Checkbox
          checked={selected.includes(entry.keyId)}
          onChange={(event) =>
            setSelected(
              event.currentTarget.checked
                ? [...selected, entry.keyId]
                : selected.filter((id) => id !== entry.keyId),
            )
          }
        />
      </Table.Td>
      <Table.Td>
        <Code>acmuiuc_{entry.keyId}</Code>
      </Table.Td>
      <Table.Td>{entry.description}</Table.Td>
      <Table.Td>
        {entry.owner === userData?.email ? "You" : entry.owner}
      </Table.Td>
      <Table.Td>
        <HumanFriendlyDate date={entry.createdAt} />
      </Table.Td>
      <Table.Td>
        {entry.expiresAt ? (
          <HumanFriendlyDate date={entry.expiresAt} />
        ) : (
          <Text size="sm">Never</Text>
        )}
      </Table.Td>
      <Table.Td>
        <Group>
          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconEye size={14} />}
            onClick={() => openViewPermissionsModal(entry)}
          >
            View Details
          </Button>
        </Group>
      </Table.Td>
    </Table.Tr>
  );

  // --- Create Form State ---
  const [roles, setRoles] = useState<AppRoles[]>([]);
  const [description, setDescription] = useState("");
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);

  return (
    <>
      <Group justify="space-between" mb="sm">
        <Group>
          <Button
            variant="filled"
            color="blue"
            leftSection={<IconPlus size={16} />}
            onClick={() => {
              setRoles([]);
              setDescription("");
              setExpiresAt(null);
              setCreateModalOpen(true);
              setCreatedKey(null);
            }}
          >
            Create API Key
          </Button>
          {selected.length > 0 && (
            <Button
              color="red"
              leftSection={<IconTrash size={16} />}
              onClick={() => confirmDelete(selected)}
            >
              Delete {pluralize("API Key", selected.length, true)}
            </Button>
          )}
        </Group>
      </Group>

      <Table.ScrollContainer minWidth={700}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>
                <Checkbox
                  checked={apiKeys ? selected.length === apiKeys.length : false}
                  onChange={(event) =>
                    setSelected(
                      event.currentTarget.checked && apiKeys
                        ? apiKeys.map((k) => k.keyId)
                        : [],
                    )
                  }
                />
              </Table.Th>
              <Table.Th>Key ID</Table.Th>
              <Table.Th>Description</Table.Th>
              <Table.Th>Owner</Table.Th>
              <Table.Th>Created</Table.Th>
              <Table.Th>Expires</Table.Th>
              <Table.Th>Permissions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {isLoading || !apiKeys ? (
              [...Array(3)].map((_, i) => (
                <Table.Tr key={`skeleton-${i}`}>
                  {Array(7)
                    .fill(0)
                    .map((_, idx) => (
                      <Table.Td key={idx}>
                        <Skeleton height={20} />
                      </Table.Td>
                    ))}
                </Table.Tr>
              ))
            ) : apiKeys.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={7}>
                  <Center>
                    <Text size="sm" c="dimmed">
                      No API keys found.
                    </Text>
                  </Center>
                </Table.Td>
              </Table.Tr>
            ) : (
              apiKeys.map(createRow)
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Text c="dimmed" size="sm">
        All times shown in local timezone (
        {Intl.DateTimeFormat().resolvedOptions().timeZone}).
      </Text>

      {/* Create Modal */}
      <Modal
        opened={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Create API Key"
        centered
      >
        <MultiSelect
          label="Roles"
          data={apiKeyAllowedRoles}
          value={roles}
          onChange={(e) => {
            setRoles(e as AppRoles[]);
          }}
          required
        />
        <TextInput
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          required
          mt="md"
        />
        <DateTimePicker
          label="Expires At (optional)"
          value={expiresAt}
          minDate={new Date(Date.now() + 60 * 24 * 60 * 1000)}
          valueFormat="MM-DD-YYYY h:mm A"
          onChange={setExpiresAt}
          clearable
          mt="md"
        />
        <Group justify="flex-end" mt="lg">
          <Button
            onClick={() =>
              handleCreate({
                roles,
                description,
                expiresAt: expiresAt
                  ? Math.floor(expiresAt.getTime() / 1000)
                  : undefined,
              })
            }
            disabled={roles.length === 0 || description.trim() === ""}
          >
            Create
          </Button>
        </Group>
      </Modal>

      {/* Created Key Modal */}
      <Modal
        opened={!!createdKey}
        onClose={() => setCreatedKey(null)}
        title="API Key Created!"
        centered
      >
        <Text mb="sm" fw={500} c="red">
          This is the only time you'll see this key. Store it securely.
        </Text>
        {createdKey ? (
          <BlurredTextDisplay text={createdKey} />
        ) : (
          "An error occurred and your key cannot be displayed"
        )}
        <Group justify="flex-end" mt="md">
          <CopyButton value={createdKey || ""}>
            {({ copied, copy }) => (
              <Button color={copied ? "teal" : "blue"} onClick={copy}>
                {copied ? "Copied!" : "Copy Key"}
              </Button>
            )}
          </CopyButton>
        </Group>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        opened={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Confirm Deletion"
        centered
      >
        <Text mb="md">
          Are you sure you want to delete the following API{" "}
          {pluralize("key", idsToDelete.length)}?
        </Text>
        <Text mb="md" fw={500} c="red">
          {pluralize("This", idsToDelete.length)}{" "}
          {pluralize("key", idsToDelete.length)} will immediately be
          deactivated, and API requests using{" "}
          {pluralize("this", idsToDelete.length)}{" "}
          {pluralize("key", idsToDelete.length)} will fail.
        </Text>
        <List>
          {idsToDelete.map((id) => (
            <List.Item key={`del-${id}`} mb="xs">
              <Text size="sm">acmuiuc_{id}</Text>
            </List.Item>
          ))}
        </List>

        <Group justify="flex-end" mt="lg">
          <Button variant="outline" onClick={() => setDeleteModalOpen(false)}>
            Cancel
          </Button>
          <Button color="red" onClick={() => handleDelete(idsToDelete)}>
            Delete
          </Button>
        </Group>
      </Modal>

      {/* View Permissions Modal - Reusing components from create modal */}
      <Modal
        opened={viewPermissionsModalOpen}
        onClose={() => setViewPermissionsModalOpen(false)}
        title="API Key Permissions"
        centered
      >
        {selectedKeyForPermissions && (
          <>
            <Text size="sm" fw={500} mb="xs">
              Key ID
            </Text>
            <Code mb="md">acmuiuc_{selectedKeyForPermissions.keyId}</Code>

            <Text size="sm" fw={500} mb="xs">
              Description
            </Text>
            <Text size="sm" mb="md">
              {selectedKeyForPermissions.description}
            </Text>

            <Text size="sm" fw={500} mb="xs">
              Roles
            </Text>
            <MultiSelect
              data={apiKeyAllowedRoles}
              value={selectedKeyForPermissions.roles as AppRoles[]}
              readOnly
              disabled
              mt="xs"
              mb="md"
            />

            <Text size="sm" fw={500} mb="xs">
              Created
            </Text>
            <Text mb="md">
              <HumanFriendlyDate date={selectedKeyForPermissions.createdAt} />
            </Text>

            <Text size="sm" fw={500} mb="xs">
              Expires
            </Text>
            <Text mb="md" size="sm">
              {selectedKeyForPermissions.expiresAt ? (
                <HumanFriendlyDate date={selectedKeyForPermissions.expiresAt} />
              ) : (
                "Never"
              )}
            </Text>

            <Text size="sm" fw={500} mb="xs">
              Owner
            </Text>
            <Text mb="md" size="sm">
              {selectedKeyForPermissions.owner === userData?.email
                ? "You"
                : selectedKeyForPermissions.owner}
            </Text>

            {selectedKeyForPermissions.restrictions && (
              <>
                <Text size="sm" fw={500} mb="xs">
                  Policy Restrictions
                </Text>
                <Code block mt="sm">
                  {JSON.stringify(
                    selectedKeyForPermissions.restrictions,
                    null,
                    2,
                  )}
                </Code>
              </>
            )}

            <Group justify="flex-end" mt="lg">
              <Button onClick={() => setViewPermissionsModalOpen(false)}>
                Close
              </Button>
            </Group>
          </>
        )}
      </Modal>
    </>
  );
};
