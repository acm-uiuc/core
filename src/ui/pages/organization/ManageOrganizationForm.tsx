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
  Table,
  Badge,
  Avatar,
  Modal,
  Divider,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconPlus, IconTrash, IconUserPlus } from "@tabler/icons-react";
import {
  LeadEntry,
  setOrganizationMetaBody,
  validOrgLinkTypes,
} from "@common/types/organizations";
import { zod4Resolver as zodResolver } from "mantine-form-zod-resolver";
import * as z from "zod/v4";

type OrganizationData = z.infer<typeof setOrganizationMetaBody>;

interface ManageOrganizationFormProps {
  organizationId: string;
  getOrganizationData: (
    orgId: string,
  ) => Promise<OrganizationData & { leads?: LeadEntry[] }>;
  updateOrganizationData: (data: OrganizationData) => Promise<void>;
  updateLeads?: (toAdd: LeadEntry[], toRemove: string[]) => Promise<void>;
  firstTime?: boolean;
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

      // Only extract the fields that are allowed in setOrganizationMetaBody
      // (excludes id, leads, leadsEntraGroupId)
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
    // Reset form state when organization changes
    setOrgData(undefined);
    setLoading(false);
    form.reset();
    setCurrentLeads([]);
    setToAdd([]);
    setToRemove([]);
    setNewLeadName("");
    setNewLeadEmail("");
    setNewLeadTitle("");

    // Fetch new organization data
    fetchOrganizationData();
  }, [organizationId]);

  const handleAddLead = () => {
    if (!newLeadName.trim() || !newLeadEmail.trim() || !newLeadTitle.trim()) {
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
      },
    ]);

    setNewLeadName("");
    setNewLeadEmail("");
    setNewLeadTitle("");
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

      // Only send the fields allowed by setOrganizationMetaBody schema
      // (description, website, links - NO id, leads, or leadsEntraGroupId)
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

  const allDisplayLeads = [
    ...currentLeads.map((lead) => ({ ...lead, isNew: false })),
    ...toAdd.map((lead) => ({ ...lead, isNew: true })),
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
            description="A brief description of your organization"
            placeholder="We are a student organization focused on..."
            {...form.getInputProps("description")}
            autosize
            minRows={3}
            maxRows={6}
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
            <Button type="submit" loading={loading} disabled={loading}>
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
                Manage who has leadership permissions for this organization
              </Text>

              <Table verticalSpacing="sm" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Lead</Table.Th>
                    <Table.Th>Title</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Actions</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {allDisplayLeads.length === 0 ? (
                    <Table.Tr>
                      <Table.Td colSpan={4}>
                        <Text c="dimmed" size="sm" ta="center">
                          No leads found.
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ) : (
                    allDisplayLeads.map((lead) => {
                      const isQueuedForRemoval = toRemove.includes(
                        lead.username,
                      );
                      return (
                        <Table.Tr key={lead.username}>
                          <Table.Td>
                            <Group gap="sm">
                              <Avatar name={lead.name} color="initials" />
                              <div>
                                <Text fz="sm" fw={500}>
                                  {lead.name}
                                </Text>
                                <Text fz="xs" c="dimmed">
                                  {lead.username}
                                </Text>
                              </div>
                            </Group>
                          </Table.Td>
                          <Table.Td>{lead.title}</Table.Td>
                          <Table.Td>
                            {isQueuedForRemoval ? (
                              <Badge color="red" variant="light">
                                Queued for removal
                              </Badge>
                            ) : lead.isNew ? (
                              <Badge color="blue" variant="light">
                                Queued for addition
                              </Badge>
                            ) : (
                              <Badge color="green" variant="light">
                                Active
                              </Badge>
                            )}
                          </Table.Td>
                          <Table.Td>
                            {isQueuedForRemoval ? (
                              <Button
                                color="yellow"
                                variant="light"
                                size="xs"
                                onClick={() =>
                                  handleCancelRemove(lead.username)
                                }
                              >
                                Cancel
                              </Button>
                            ) : lead.isNew ? (
                              <Button
                                color="red"
                                variant="light"
                                size="xs"
                                leftSection={<IconTrash size={14} />}
                                onClick={() => handleCancelAdd(lead.username)}
                              >
                                Cancel Add
                              </Button>
                            ) : (
                              <Button
                                color="red"
                                variant="light"
                                size="xs"
                                onClick={() => handleQueueRemove(lead.username)}
                                leftSection={<IconTrash size={14} />}
                              >
                                Remove
                              </Button>
                            )}
                          </Table.Td>
                        </Table.Tr>
                      );
                    })
                  )}
                </Table.Tbody>
              </Table>

              <Stack gap="xs" mt="md">
                <TextInput
                  label="Lead Name"
                  placeholder="John Doe"
                  value={newLeadName}
                  onChange={(e) => setNewLeadName(e.currentTarget.value)}
                />
                <TextInput
                  label="Lead Email"
                  description="Please use their Illinois email!"
                  placeholder="email@illinois.edu"
                  value={newLeadEmail}
                  onChange={(e) => setNewLeadEmail(e.currentTarget.value)}
                />
                <TextInput
                  label="Lead Title"
                  placeholder="Chair"
                  value={newLeadTitle}
                  onChange={(e) => setNewLeadTitle(e.currentTarget.value)}
                />
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
              >
                Save Lead Changes ({toAdd.length} Additions, {toRemove.length}{" "}
                Removals)
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
