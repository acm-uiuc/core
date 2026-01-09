import React, { useEffect, useState } from "react";
import {
  TextInput,
  Textarea,
  Button,
  Group,
  Box,
  LoadingOverlay,
  Alert,
  Title,
  Text,
  ActionIcon,
  Stack,
  Select,
  Paper,
  Badge,
  Avatar,
  Modal,
  Divider,
  Combobox,
  useCombobox,
  InputBase,
  Checkbox,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
  IconPlus,
  IconTrash,
  IconUserPlus,
  IconAlertTriangle,
  IconDeviceFloppy,
} from "@tabler/icons-react";
import {
  LeadEntry,
  leadTitleSuggestions,
  MAX_ORG_DESCRIPTION_CHARS,
  setOrganizationMetaBody,
  validOrgLinkTypes,
} from "@common/types/organizations";
import { zod4Resolver as zodResolver } from "mantine-form-zod-resolver";
import * as z from "zod/v4";
import { ResponsiveTable, Column } from "@ui/components/ResponsiveTable";
import { NameOptionalUserCard } from "@ui/components/NameOptionalCard";
import { OrganizationId } from "@acm-uiuc/js-shared";

type OrganizationData = z.infer<typeof setOrganizationMetaBody>;

interface ManageOrganizationFormProps {
  organizationId: OrganizationId;
  getOrganizationData: (
    orgId: string,
  ) => Promise<OrganizationData & { leads?: LeadEntry[] }>;
  updateOrganizationData: (data: OrganizationData) => Promise<void>;
  updateLeads?: (toAdd: LeadEntry[], toRemove: string[]) => Promise<void>;
  firstTime?: boolean;
}

interface DisplayLead extends LeadEntry {
  isNew: boolean;
  isQueuedForRemoval: boolean;
}

export const ManageOrganizationForm: React.FC<ManageOrganizationFormProps> = ({
  organizationId,
  getOrganizationData,
  updateOrganizationData,
  updateLeads,
}) => {
  const [orgData, setOrgData] = useState<OrganizationData | null | undefined>(
    undefined,
  );
  const [loading, setLoading] = useState(false);

  // Lead management state
  const [currentLeads, setCurrentLeads] = useState<LeadEntry[]>([]);
  const [toAdd, setToAdd] = useState<LeadEntry[]>([]);
  const [toRemove, setToRemove] = useState<string[]>([]);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);

  // New lead form state
  const [newLeadName, setNewLeadName] = useState("");
  const [newLeadEmail, setNewLeadEmail] = useState("");
  const [newLeadTitle, setNewLeadTitle] = useState("");
  const [newLeadNonVoting, setNewLeadNonVoting] = useState(false);

  // Combobox for title suggestions
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  });

  const filteredTitles = leadTitleSuggestions.filter((title) =>
    title.toLowerCase().includes(newLeadTitle.toLowerCase()),
  );

  const form = useForm({
    validate: zodResolver(setOrganizationMetaBody),
    initialValues: {
      description: undefined,
      website: undefined,
      links: undefined,
    } as OrganizationData,
  });

  const fetchOrganizationData = async () => {
    setLoading(true);
    try {
      const data = await getOrganizationData(organizationId);
      setOrgData(data);
      setCurrentLeads(data.leads || []);
      setToAdd([]);
      setToRemove([]);

      form.setValues({
        description: data.description,
        website: data.website,
        links: data.links || [],
      });
    } catch (e) {
      console.error(e);
      setOrgData(null);
      notifications.show({
        color: "red",
        message: "Failed to load organization data",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setOrgData(undefined);
    setLoading(false);
    form.reset();
    setCurrentLeads([]);
    setToAdd([]);
    setToRemove([]);
    setNewLeadName("");
    setNewLeadEmail("");
    setNewLeadTitle("");
    setNewLeadNonVoting(false);

    fetchOrganizationData();
  }, [organizationId]);

  const handleAddLead = () => {
    if (!newLeadEmail.trim() || !newLeadTitle.trim()) {
      notifications.show({
        title: "Invalid Input",
        message: "All fields are required to add a lead.",
        color: "orange",
      });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newLeadEmail)) {
      notifications.show({
        title: "Invalid Email",
        message: "Please enter a valid email address.",
        color: "orange",
      });
      return;
    }

    if (
      currentLeads.some((lead) => lead.username === newLeadEmail) ||
      toAdd.some((lead) => lead.username === newLeadEmail)
    ) {
      notifications.show({
        title: "Duplicate Lead",
        message: "This user is already a lead or queued for addition.",
        color: "orange",
      });
      return;
    }

    setToAdd((prev) => [
      ...prev,
      {
        name: newLeadName.trim(),
        username: newLeadEmail.trim(),
        title: newLeadTitle.trim(),
        nonVotingMember: newLeadNonVoting,
      },
    ]);

    setNewLeadName("");
    setNewLeadEmail("");
    setNewLeadTitle("");
    setNewLeadNonVoting(false);
  };

  const handleQueueRemove = (email: string) => {
    if (!toRemove.includes(email)) {
      setToRemove((prev) => [...prev, email]);
    }
  };

  const handleCancelRemove = (email: string) => {
    setToRemove((prev) => prev.filter((e) => e !== email));
  };

  const handleCancelAdd = (email: string) => {
    setToAdd((prev) => prev.filter((lead) => lead.username !== email));
  };

  const handleSaveLeads = async () => {
    if (!updateLeads) {
      notifications.show({
        title: "Feature Not Available",
        message: "Lead management is not available for this organization.",
        color: "orange",
      });
      return;
    }

    setLoading(true);
    try {
      await updateLeads(toAdd, toRemove);
      await fetchOrganizationData();
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
      setConfirmModalOpen(false);
    }
  };

  const handleSubmit = async () => {
    if (!orgData) {
      return;
    }
    setLoading(true);
    try {
      const values = form.values;

      const cleanedData: OrganizationData = {
        description: values.description?.trim() || undefined,
        website: values.website?.trim() || undefined,
        links:
          values.links && values.links.length > 0
            ? values.links.filter((link) => link.url.trim() && link.type)
            : undefined,
      };

      await updateOrganizationData(cleanedData);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const addLink = () => {
    form.insertListItem("links", { type: "OTHER", url: "" });
  };

  const removeLink = (index: number) => {
    form.removeListItem("links", index);
  };

  const allDisplayLeads: DisplayLead[] = [
    ...currentLeads.map((lead) => ({
      ...lead,
      isNew: false,
      isQueuedForRemoval: toRemove.includes(lead.username),
    })),
    ...toAdd.map((lead) => ({
      ...lead,
      isNew: true,
      isQueuedForRemoval: false,
    })),
  ];

  // Define columns for leads table
  const leadsColumns: Column<DisplayLead>[] = [
    {
      key: "lead",
      label: "Lead",
      isPrimaryColumn: true,
      render: (lead) => (
        <Group>
          <NameOptionalUserCard email={lead.username} />
          {lead.nonVotingMember && (
            <Badge color="gray" variant="light" size="sm" ml="xs">
              Non-Voting
            </Badge>
          )}
        </Group>
      ),
    },
    {
      key: "title",
      label: "Title",
      render: (lead) => lead.title,
    },
    {
      key: "status",
      label: "Status",
      render: (lead) => {
        if (lead.isQueuedForRemoval) {
          return (
            <Badge color="red" variant="light">
              Queued for removal
            </Badge>
          );
        }
        if (lead.isNew) {
          return (
            <Badge color="blue" variant="light">
              Queued for addition
            </Badge>
          );
        }
        return (
          <Badge color="green" variant="light">
            Active
          </Badge>
        );
      },
    },
    {
      key: "actions",
      label: "Actions",
      hideMobileLabel: true,
      render: (lead) => {
        if (lead.isQueuedForRemoval) {
          return (
            <Button
              color="yellow"
              variant="light"
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                handleCancelRemove(lead.username);
              }}
            >
              Cancel
            </Button>
          );
        }
        if (lead.isNew) {
          return (
            <Button
              color="red"
              variant="light"
              size="xs"
              leftSection={<IconTrash size={14} />}
              onClick={(e) => {
                e.stopPropagation();
                handleCancelAdd(lead.username);
              }}
            >
              Cancel Add
            </Button>
          );
        }
        return (
          <Button
            color="red"
            variant="light"
            size="xs"
            onClick={(e) => {
              e.stopPropagation();
              handleQueueRemove(lead.username);
            }}
            leftSection={<IconTrash size={14} />}
          >
            Remove
          </Button>
        );
      },
    },
  ];

  if (orgData === undefined) {
    return <LoadingOverlay visible data-testid="org-loading" />;
  }

  return (
    <>
      <Box>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <Textarea
            label="Description"
            description={`A brief description of your organization. Maximum ${MAX_ORG_DESCRIPTION_CHARS} characters.`}
            placeholder="We are a student organization focused on..."
            {...form.getInputProps("description")}
            autosize
            minRows={1}
            maxRows={3}
            mb="md"
          />

          <TextInput
            label="Website"
            description="Your organization's website URL"
            placeholder="https://example.com"
            {...form.getInputProps("website")}
            mb="md"
          />

          <Paper withBorder p="md" mb="md">
            <Group justify="space-between" mb="sm">
              <div>
                <Text fw={500}>Social & Communication Links</Text>
                <Text size="sm" c="dimmed">
                  Add links to your social media and communication platforms
                </Text>
              </div>
              <Button
                leftSection={<IconPlus size={16} />}
                onClick={addLink}
                variant="light"
                size="sm"
              >
                Add Link
              </Button>
            </Group>

            {form.values.links && form.values.links.length > 0 ? (
              <Stack gap="md">
                {form.values.links.map((_, index) => (
                  <Group key={index} align="start" gap="sm">
                    <Select
                      label="Type"
                      placeholder="Select type"
                      data={validOrgLinkTypes.map((type) => ({
                        value: type,
                        label: type.charAt(0) + type.slice(1).toLowerCase(),
                      }))}
                      {...form.getInputProps(`links.${index}.type`)}
                      style={{ flex: 1, minWidth: 150 }}
                      required
                    />

                    <TextInput
                      label="URL"
                      placeholder="https://..."
                      {...form.getInputProps(`links.${index}.url`)}
                      style={{ flex: 2, minWidth: 250 }}
                      required
                    />

                    <ActionIcon
                      color="red"
                      variant="light"
                      onClick={() => removeLink(index)}
                      mt={28}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                ))}
              </Stack>
            ) : (
              <Text size="sm" c="dimmed" ta="center" py="md">
                No links added yet. Click "Add Link" to get started.
              </Text>
            )}
          </Paper>

          <Group mt="md">
            <Button
              type="submit"
              loading={loading}
              disabled={loading}
              leftSection={<IconDeviceFloppy size={16} color="white" />}
            >
              Save Changes
            </Button>
          </Group>
        </form>

        {updateLeads && (
          <>
            <Divider my="xl" />

            <Paper withBorder p="md" mb="md">
              <Title order={4} mb="md">
                Organization Leads
              </Title>
              <Text size="sm" c="dimmed" mb="md">
                These users will be given management permissions for your org.
                Voting members must be paid members and will be your org's
                represenatives at Executive Council meetings.
              </Text>

              {allDisplayLeads.length === 0 ? (
                <Text c="dimmed" size="sm" ta="center" py="xl">
                  No leads found.
                </Text>
              ) : (
                <ResponsiveTable
                  data={allDisplayLeads}
                  columns={leadsColumns}
                  keyExtractor={(lead) => lead.username}
                  testIdPrefix="lead-row"
                  cardColumns={{ base: 1, xs: 2 }}
                />
              )}

              <Stack gap="xs" mt="xl">
                <TextInput
                  label="Lead Email"
                  description="The lead's @illinois.edu email"
                  placeholder="user@illinois.edu"
                  value={newLeadEmail}
                  onChange={(e) => setNewLeadEmail(e.currentTarget.value)}
                />
                <Combobox
                  store={combobox}
                  onOptionSubmit={(val) => {
                    setNewLeadTitle(val);
                    combobox.closeDropdown();
                  }}
                >
                  <Combobox.Target>
                    <InputBase
                      label="Lead Title"
                      placeholder="Chair"
                      value={newLeadTitle}
                      onChange={(e) => {
                        setNewLeadTitle(e.currentTarget.value);
                        combobox.openDropdown();
                        combobox.updateSelectedOptionIndex();
                      }}
                      onClick={() => combobox.openDropdown()}
                      onFocus={() => combobox.openDropdown()}
                      onBlur={() => combobox.closeDropdown()}
                      rightSection={<Combobox.Chevron />}
                      rightSectionPointerEvents="none"
                    />
                  </Combobox.Target>

                  <Combobox.Dropdown>
                    <Combobox.Options>
                      {filteredTitles.length > 0 ? (
                        filteredTitles.map((title) => (
                          <Combobox.Option value={title} key={title}>
                            {title}
                          </Combobox.Option>
                        ))
                      ) : (
                        <Combobox.Empty>No matches found</Combobox.Empty>
                      )}
                    </Combobox.Options>
                  </Combobox.Dropdown>
                </Combobox>

                <Checkbox
                  label="Non-voting member"
                  description={`Check this if the lead should not have voting rights for ${organizationId} in the Executive Council`}
                  checked={newLeadNonVoting}
                  onChange={(e) => setNewLeadNonVoting(e.currentTarget.checked)}
                />

                {newLeadNonVoting && (
                  <Alert
                    icon={<IconAlertTriangle size={16} />}
                    color="yellow"
                    variant="light"
                    mt="xs"
                  >
                    <Text size="sm" fw={500} mb={4}>
                      Warning: Non-voting member
                    </Text>
                    <Text size="sm">
                      This lead will have management permissions but will not
                      have voting rights for your organization in Executive
                      Council meetings. Use this designation carefully.
                    </Text>
                  </Alert>
                )}
              </Stack>

              <Button
                mt="md"
                leftSection={<IconUserPlus size={16} />}
                onClick={handleAddLead}
                disabled={loading}
              >
                Add Lead
              </Button>

              <Button
                fullWidth
                color="blue"
                mt="xl"
                onClick={() => setConfirmModalOpen(true)}
                disabled={(!toAdd.length && !toRemove.length) || loading}
                loading={loading}
                leftSection={<IconDeviceFloppy size={16} color="white" />}
                data-testid="save-lead-changes"
              >
                Save Changes
              </Button>
            </Paper>

            <Modal
              opened={confirmModalOpen}
              onClose={() => setConfirmModalOpen(false)}
              title="Confirm Changes"
              centered
            >
              {toAdd.length > 0 && (
                <Box mb="md">
                  <Text fw={500} size="sm" mb="xs">
                    Leads to Add:
                  </Text>
                  {toAdd.map((lead) => (
                    <Text key={lead.username} fz="sm">
                      - {lead.name} ({lead.username}) - {lead.title}
                      {lead.nonVotingMember && (
                        <Badge color="gray" variant="light" size="sm" ml="xs">
                          Non-Voting
                        </Badge>
                      )}
                    </Text>
                  ))}
                </Box>
              )}
              {toRemove.length > 0 && (
                <Box>
                  <Text fw={500} size="sm" mb="xs">
                    Leads to Remove:
                  </Text>
                  {toRemove.map((email) => (
                    <Text key={email} fz="sm" c="red">
                      - {email}
                    </Text>
                  ))}
                </Box>
              )}
              <Group justify="flex-end" mt="lg">
                <Button
                  variant="outline"
                  onClick={() => setConfirmModalOpen(false)}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveLeads}
                  loading={loading}
                  color="blue"
                >
                  Confirm and Save
                </Button>
              </Group>
            </Modal>
          </>
        )}
      </Box>
    </>
  );
};
