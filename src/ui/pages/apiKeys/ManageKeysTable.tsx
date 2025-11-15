import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Code,
  CopyButton,
  Group,
  JsonInput,
  List,
  Modal,
  MultiSelect,
  Skeleton,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import {
  IconAlertCircle,
  IconEye,
  IconHandStop,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import {
  apiKeyAllowedRoles,
  ApiKeyMaskedEntry,
  ApiKeyPostBody,
  policyUnion,
} from "@common/types/apiKey";
import { useAuth } from "@ui/components/AuthContext";
import { notifications } from "@mantine/notifications";
import pluralize from "pluralize";
import dayjs from "dayjs";
import { AppRoles } from "@common/roles";
import { BlurredTextDisplay } from "../../components/BlurredTextDisplay";
import * as z from "zod/v4";
import { ResponsiveTable, Column } from "@ui/components/ResponsiveTable";
import { NameOptionalUserCard } from "@ui/components/NameOptionalCard";

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

interface DisplayApiKey extends ApiKeyMaskedEntry {
  isSelected: boolean;
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
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [idsToDelete, setIdsToDelete] = useState<string[]>([]);
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
      setDeleteModalOpen(false);
    }
  };

  const confirmDelete = (ids: string[]) => {
    setIdsToDelete(ids);
    setDeleteModalOpen(true);
  };

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
        title: "Unable to create API key.",
        message: "Please try again or contact support.",
        color: "red",
      });
    }
  };

  const handleSelectRow = (keyId: string, checked: boolean) => {
    setSelected(
      checked ? [...selected, keyId] : selected.filter((id) => id !== keyId),
    );
  };

  const handleSelectAll = () => {
    if (!apiKeys) {
      return;
    }
    if (selected.length === apiKeys.length) {
      setSelected([]);
    } else {
      setSelected(apiKeys.map((k) => k.keyId));
    }
  };

  // Create Form State
  const [roles, setRoles] = useState<AppRoles[]>([]);
  const [description, setDescription] = useState("");
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [policyDocument, setPolicyDocument] = useState("");

  const displayApiKeys: DisplayApiKey[] = apiKeys
    ? apiKeys.map((key) => ({
        ...key,
        isSelected: selected.includes(key.keyId),
      }))
    : [];

  // Define columns for API keys table
  const apiKeyColumns: Column<DisplayApiKey>[] = [
    {
      key: "select",
      label: "Select",
      hideMobileLabel: true,
      render: (key) => (
        <Checkbox
          checked={key.isSelected}
          onChange={(event) =>
            handleSelectRow(key.keyId, event.currentTarget.checked)
          }
        />
      ),
    },
    {
      key: "keyId",
      label: "Key ID",
      isPrimaryColumn: true,
      render: (key) => <Code>acmuiuc_{key.keyId}</Code>,
    },
    {
      key: "description",
      label: "Description",
      render: (key) => (
        <Text
          size="sm"
          style={{ wordBreak: "break-word", overflowWrap: "break-word" }}
        >
          {key.description}
        </Text>
      ),
    },
    {
      key: "owner",
      label: "Owner",
      render: (key) => <NameOptionalUserCard size="sm" email={key.owner} />,
    },
    {
      key: "created",
      label: "Created",
      render: (key) => <HumanFriendlyDate date={key.createdAt} />,
    },
    {
      key: "expires",
      label: "Expires",
      render: (key) =>
        key.expiresAt ? (
          <HumanFriendlyDate date={key.expiresAt} />
        ) : (
          <Text size="sm">Never</Text>
        ),
    },
    {
      key: "permissions",
      label: "Permissions",
      hideMobileLabel: true,
      render: (key) => (
        <Button
          variant="subtle"
          size="xs"
          leftSection={<IconEye size={14} />}
          onClick={(e) => {
            e.stopPropagation();
            openViewPermissionsModal(key);
          }}
        >
          View Details
        </Button>
      ),
    },
  ];

  const skeletonRows = Array.from({ length: 3 }).map((_, index) => (
    <Skeleton key={`skeleton-${index}`} height={60} radius="sm" mb="sm" />
  ));

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <Group>
          <Button
            variant="filled"
            color="blue"
            leftSection={<IconPlus size={16} />}
            onClick={() => {
              setRoles([]);
              setDescription("");
              setExpiresAt(null);
              setPolicyDocument("");
              setCreateModalOpen(true);
              setCreatedKey(null);
            }}
          >
            Create API Key
          </Button>
          <Button
            variant="light"
            onClick={handleSelectAll}
            disabled={isLoading || !apiKeys || apiKeys.length === 0}
          >
            {selected.length === apiKeys?.length
              ? "Deselect All"
              : "Select All"}
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

      {isLoading || !apiKeys ? (
        <Stack gap="sm">{skeletonRows}</Stack>
      ) : apiKeys.length === 0 ? (
        <Text c="dimmed" size="sm" ta="center" py="xl">
          No API keys found. Click "Create API Key" to get started.
        </Text>
      ) : (
        <ResponsiveTable
          data={displayApiKeys}
          columns={apiKeyColumns}
          keyExtractor={(key) => key.keyId}
          testIdPrefix="api-key-row"
          cardColumns={{ base: 1, sm: 2 }}
        />
      )}

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
          onChange={(value) => {
            if (typeof value === "string") {
              setExpiresAt(value ? new Date(value) : null);
            } else {
              setExpiresAt(value);
            }
          }}
          clearable
          mt="md"
        />

        <JsonInput
          label="Policy Document (optional)"
          description={
            <Alert
              icon={<IconHandStop />}
              title="Advanced Feature"
              color="orange"
            >
              Errors in this field will prevent your API key from working!
              Please consult the API documentation for instructions.
            </Alert>
          }
          value={policyDocument}
          onChange={setPolicyDocument}
          placeholder={`[
            {
              "name": "EventsHostRestrictionPolicy",
              "params": {
                "host": [
                  "ACM"
                ]
              }
            }
          ]`}
          validationError="Invalid JSON"
          formatOnBlur
          autosize
          minRows={6}
        />

        <Group justify="flex-end" mt="lg">
          <Button
            onClick={() => {
              let parsedPolicyDocument = undefined;
              try {
                if (policyDocument && policyDocument.trim() !== "") {
                  parsedPolicyDocument = z
                    .array(policyUnion)
                    .parse(JSON.parse(policyDocument));
                }
                handleCreate({
                  roles,
                  description,
                  expiresAt: expiresAt
                    ? Math.floor(expiresAt.getTime() / 1000)
                    : undefined,
                  restrictions: parsedPolicyDocument,
                });
              } catch (e) {
                console.error(e);
                notifications.show({
                  title: "Invalid policy document!",
                  message: "Please correct the policy document and try again.",
                  color: "red",
                });
              }
            }}
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

      {/* View Permissions Modal */}
      <Modal
        opened={viewPermissionsModalOpen}
        onClose={() => setViewPermissionsModalOpen(false)}
        title="API Key Permissions"
        centered
      >
        {selectedKeyForPermissions && (
          <Stack gap="md">
            <div>
              <Text size="sm" fw={500} mb="xs">
                Key ID
              </Text>
              <Code>acmuiuc_{selectedKeyForPermissions.keyId}</Code>
            </div>

            <div>
              <Text size="sm" fw={500} mb="xs">
                Description
              </Text>
              <Text size="sm">{selectedKeyForPermissions.description}</Text>
            </div>

            <div>
              <Text size="sm" fw={500} mb="xs">
                Roles
              </Text>
              <MultiSelect
                data={apiKeyAllowedRoles}
                value={selectedKeyForPermissions.roles as AppRoles[]}
                readOnly
                disabled
              />
            </div>

            <div>
              <Text size="sm" fw={500} mb="xs">
                Created
              </Text>
              <HumanFriendlyDate date={selectedKeyForPermissions.createdAt} />
            </div>

            <div>
              <Text size="sm" fw={500} mb="xs">
                Expires
              </Text>
              <Text size="sm">
                {selectedKeyForPermissions.expiresAt ? (
                  <HumanFriendlyDate
                    date={selectedKeyForPermissions.expiresAt}
                  />
                ) : (
                  "Never"
                )}
              </Text>
            </div>

            <div>
              <Text size="sm" fw={500} mb="xs">
                Owner
              </Text>
              <Text size="sm">
                {selectedKeyForPermissions.owner === userData?.email
                  ? "You"
                  : selectedKeyForPermissions.owner}
              </Text>
            </div>

            {selectedKeyForPermissions.restrictions && (
              <div>
                <Text size="sm" fw={500} mb="xs">
                  Policy Restrictions
                </Text>
                <Code block>
                  {JSON.stringify(
                    selectedKeyForPermissions.restrictions,
                    null,
                    2,
                  )}
                </Code>
              </div>
            )}

            <Group justify="flex-end">
              <Button onClick={() => setViewPermissionsModalOpen(false)}>
                Close
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
};
