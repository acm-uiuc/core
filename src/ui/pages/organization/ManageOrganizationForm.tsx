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
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconPlus, IconTrash, IconInfoCircle } from "@tabler/icons-react";
import {
  setOrganizationMetaBody,
  validOrgLinkTypes,
} from "@common/types/organizations";
import { zod4Resolver as zodResolver } from "mantine-form-zod-resolver";
import * as z from "zod/v4";

type OrganizationData = z.infer<typeof setOrganizationMetaBody>;

interface ManageOrganizationFormProps {
  organizationId: string;
  getOrganizationData: (orgId: string) => Promise<OrganizationData>;
  updateOrganizationData: (data: OrganizationData) => Promise<void>;
  firstTime?: boolean;
}

export const ManageOrganizationForm: React.FC<ManageOrganizationFormProps> = ({
  organizationId,
  getOrganizationData,
  updateOrganizationData,
  firstTime = false,
}) => {
  const [orgData, setOrgData] = useState<OrganizationData | null | undefined>(
    undefined,
  );
  const [loading, setLoading] = useState(false);

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

    // Fetch new organization data
    fetchOrganizationData();
  }, [organizationId]);

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
      </Box>
    </>
  );
};
