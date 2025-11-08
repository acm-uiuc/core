import {
  Title,
  Box,
  TextInput,
  Textarea,
  Switch,
  Select,
  Button,
  Loader,
  Group,
  ActionIcon,
  Text,
  Alert,
  Tabs,
  Card,
  Stack,
  SimpleGrid,
  List,
} from "@mantine/core";
import moment from "moment-timezone";
import { DateFormatter, DatePickerInput, DateTimePicker } from "@mantine/dates";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import dayjs from "dayjs";
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as z from "zod/v4";
import { AuthGuard } from "@ui/components/AuthGuard";
import { useApi } from "@ui/util/api";
import { AllOrganizationNameList as orgList } from "@acm-uiuc/js-shared";
import { AppRoles } from "@common/roles";
import { EVENT_CACHED_DURATION } from "@common/config";
import {
  IconAlertCircle,
  IconInfoCircle,
  IconPlus,
  IconTrash,
  IconSparkles,
} from "@tabler/icons-react";
import {
  MAX_METADATA_KEYS,
  MAX_KEY_LENGTH,
  MAX_VALUE_LENGTH,
  metadataSchema,
} from "@common/types/events";
import { zod4Resolver as zodResolver } from "mantine-form-zod-resolver";

import FullScreenLoader from "@ui/components/AuthContext/LoadingScreen";
import { useAuth } from "@ui/components/AuthContext";
import { getPrimarySuggestedOrg } from "@ui/util";
import { EVENT_TEMPLATES } from "./templates";

export function capitalizeFirstLetter(string: string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

const valueFormatter: DateFormatter = ({ type, date, locale, format }) => {
  if (type === "multiple" && Array.isArray(date)) {
    if (date.length === 1) {
      return dayjs(date[0]).locale(locale).format(format);
    }

    if (date.length > 1) {
      return date
        .map((d) => dayjs(d).locale(locale).format(format))
        .join(" | ");
    }

    return "";
  }

  return "";
};

const repeatOptions = ["weekly", "biweekly"] as const;

const FORBIDDEN_PATTERNS = [/{{.+}}/];

const containsForbiddenPattern = (text: string): boolean => {
  return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(text));
};

const findForbiddenMatches = (text: string): string[] => {
  const matches: string[] = [];
  FORBIDDEN_PATTERNS.forEach((pattern) => {
    const match = text.match(pattern);
    if (match) {
      matches.push(match[0]);
    }
  });
  return matches;
};

const baseBodySchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  start: z.date(),
  end: z.optional(z.date()),
  location: z.string().min(1, "Location is required"),
  locationLink: z.optional(z.string().url("Invalid URL")),
  host: z.string().min(1, "Host is required"),
  featured: z.boolean().default(false),
  paidEventId: z
    .string()
    .min(1, "Paid Event ID must be at least 1 character")
    .optional(),
  metadata: metadataSchema,
});

const requestBodySchema = baseBodySchema
  .extend({
    start: z.coerce.date(),
    end: z.coerce.date(),
    description: z.string().min(1).max(250),
    repeats: z.optional(z.enum(repeatOptions)).nullable(),
    repeatEnds: z.coerce.date().optional(),
    repeatExcludes: z.array(z.coerce.date()).max(100).optional(),
  })
  .refine((data) => (data.repeatEnds ? data.repeats !== undefined : true), {
    message: "Repeat frequency is required when Repeat End is specified.",
  })
  .refine((data) => !data.end || data.end >= data.start, {
    message: "Event end date cannot be earlier than the start date.",
    path: ["end"],
  })
  .refine((data) => !data.repeatEnds || data.repeatEnds >= data.start, {
    message: "Repeat end date cannot be earlier than the start date.",
    path: ["repeatEnds"],
  })
  .refine((data) => !containsForbiddenPattern(data.title), {
    message: "Title contains template placeholders that need to be replaced",
    path: ["title"],
  })
  .refine((data) => !containsForbiddenPattern(data.description), {
    message:
      "Description contains template placeholders that need to be replaced",
    path: ["description"],
  })
  .refine((data) => !containsForbiddenPattern(data.location), {
    message: "Location contains template placeholders that need to be replaced",
    path: ["location"],
  });

type EventPostRequest = z.infer<typeof requestBodySchema>;

// Helper function to replace template variables
const applyTemplateVariables = (
  text: string,
  variables: Record<string, string>,
): string => {
  let result = text;
  Object.entries(variables).forEach(([key, value]) => {
    result = result.replace(new RegExp(`{{${key}}}`, "g"), value);
  });
  return result;
};

// EventForm Component - extracted to prevent re-mounting
interface EventFormProps {
  form: ReturnType<typeof useForm<EventPostRequest>>;
  selectedTemplate: keyof typeof EVENT_TEMPLATES | null;
  isSubmitting: boolean;
  isEditing: boolean;
  onSetSelectedTemplate: (
    template: keyof typeof EVENT_TEMPLATES | null,
  ) => void;
  onSubmit: () => void;
}

const EventFormComponent: React.FC<EventFormProps> = ({
  form,
  selectedTemplate,
  isSubmitting,
  isEditing,
  onSetSelectedTemplate,
  onSubmit,
}) => {
  // Metadata management with stable IDs
  const [metadataEntries, setMetadataEntries] = useState<
    Array<{ id: string; key: string; value: string }>
  >([]);

  // Track if we've initialized from form data to avoid re-syncing on user edits
  const initializedRef = React.useRef(false);

  // Sync metadata entries with form values only when loading/initializing
  useEffect(() => {
    const currentMetadata = form.values.metadata || {};
    const currentKeys = Object.keys(currentMetadata);

    // Only sync if we haven't initialized yet and there's metadata to load
    if (!initializedRef.current && currentKeys.length > 0) {
      setMetadataEntries(
        currentKeys.map((key) => ({
          id: `meta-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          key,
          value: currentMetadata[key],
        })),
      );
      initializedRef.current = true;
    }
  }, [form.values.metadata]);

  const addMetadataField = () => {
    const currentMetadata = { ...form.values.metadata };
    if (Object.keys(currentMetadata).length >= MAX_METADATA_KEYS) {
      notifications.show({
        message: `You can add at most ${MAX_METADATA_KEYS} metadata keys.`,
      });
      return;
    }

    let tempKey = `key${Object.keys(currentMetadata).length + 1}`;
    while (currentMetadata[tempKey] !== undefined) {
      tempKey = `key${parseInt(tempKey.replace("key", ""), 10) + 1}`;
    }

    const newId = `meta-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Update both form metadata and entries together
    form.setFieldValue("metadata", {
      ...currentMetadata,
      [tempKey]: "",
    });

    setMetadataEntries([
      ...metadataEntries,
      { id: newId, key: tempKey, value: "" },
    ]);
  };

  const updateMetadataValue = (entryId: string, value: string) => {
    const entry = metadataEntries.find((e) => e.id === entryId);
    if (!entry) {
      return;
    }

    // Update form metadata
    form.setFieldValue("metadata", {
      ...form.values.metadata,
      [entry.key]: value,
    });

    // Update entry value
    setMetadataEntries(
      metadataEntries.map((e) => (e.id === entryId ? { ...e, value } : e)),
    );
  };

  const updateMetadataKey = (entryId: string, newKey: string) => {
    const entry = metadataEntries.find((e) => e.id === entryId);
    if (!entry || entry.key === newKey) {
      return;
    }

    // Update form metadata
    const metadata = { ...form.values.metadata };
    const value = metadata[entry.key];
    delete metadata[entry.key];
    metadata[newKey] = value;

    form.setFieldValue("metadata", metadata);

    // Update entry key
    setMetadataEntries(
      metadataEntries.map((e) =>
        e.id === entryId ? { ...e, key: newKey } : e,
      ),
    );
  };

  const removeMetadataField = (entryId: string) => {
    const entry = metadataEntries.find((e) => e.id === entryId);
    if (!entry) {
      return;
    }

    // Update form metadata
    const currentMetadata = { ...form.values.metadata };
    delete currentMetadata[entry.key];

    form.setFieldValue("metadata", currentMetadata);

    // Remove entry
    setMetadataEntries(metadataEntries.filter((e) => e.id !== entryId));
  };

  return (
    <>
      {selectedTemplate && EVENT_TEMPLATES[selectedTemplate].guidance && (
        <Alert
          variant="light"
          color="yellow"
          mb="md"
          icon={<IconInfoCircle />}
          title="Template Checklist"
          onClose={() => onSetSelectedTemplate(null)}
          withCloseButton
        >
          <Text size="sm">Make sure to:</Text>
          <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
            {EVENT_TEMPLATES[selectedTemplate].guidance.map((item, idx) => (
              <li key={idx} style={{ marginBottom: "0.1rem" }}>
                <Text size="sm" style={{ whiteSpace: "pre-line" }}>
                  {item}
                </Text>
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <Alert
        variant="light"
        color="blue"
        mb="md"
        icon={<IconInfoCircle />}
        title="Writing Tips"
      >
        <Text size="sm">
          <strong>Title:</strong> Be clear and concise. Take a look at the
          current calendar for some examples!
          <br />
          <strong>Description:</strong> Focus on what attendees will do or
          learn. Keep it under 250 characters!
        </Text>
      </Alert>

      {Intl.DateTimeFormat().resolvedOptions().timeZone !==
        "America/Chicago" && (
        <Alert
          variant="light"
          color="red"
          mb="md"
          title="Timezone Alert"
          icon={<IconInfoCircle />}
        >
          All dates and times are shown in the America/Chicago timezone. Please
          ensure you enter them in the America/Chicago timezone.
        </Alert>
      )}

      <TextInput
        label="Event Title"
        withAsterisk
        placeholder="Event Title"
        {...form.getInputProps("title")}
      />

      <Textarea
        label="Event Description"
        withAsterisk
        placeholder="Why should people come to this event?"
        description={`${form.values.description.length}/250 characters. Be concise!`}
        {...form.getInputProps("description")}
      />

      <DateTimePicker
        label="Start Date & Time"
        withAsterisk
        valueFormat="MM/DD/YYYY h:mm A"
        placeholder="Pick start date"
        {...form.getInputProps("start")}
      />

      <DateTimePicker
        label="End Date & Time"
        withAsterisk
        valueFormat="MM/DD/YYYY h:mm A"
        placeholder="Pick end date"
        {...form.getInputProps("end")}
      />

      <TextInput
        label="Event Location"
        withAsterisk
        placeholder="ACM Room"
        {...form.getInputProps("location")}
      />

      <TextInput
        label="Location Link"
        placeholder="Google Maps link for location"
        {...form.getInputProps("locationLink")}
      />

      <Select
        label="Host"
        placeholder="Select host organization"
        searchable
        withAsterisk
        data={orgList.map((org) => ({ value: org, label: org }))}
        {...form.getInputProps("host")}
      />

      <Switch
        label={`Show on home page carousel${!form.values.repeats ? " and Discord" : ""}?`}
        style={{ paddingTop: "0.5em" }}
        {...form.getInputProps("featured", { type: "checkbox" })}
      />

      <Select
        label="Repeats"
        placeholder="Select repeat frequency"
        searchable
        data={repeatOptions.map((option) => ({
          value: option,
          label: capitalizeFirstLetter(option),
        }))}
        clearable
        {...form.getInputProps("repeats")}
      />

      {form.values.repeats && (
        <>
          <DateTimePicker
            valueFormat="MM/DD/YYYY h:mm A"
            label="Repeat Ends"
            placeholder="Pick repeat end date"
            {...form.getInputProps("repeatEnds")}
          />

          <DatePickerInput
            label="Repeat Excludes"
            description="Dates selected here will be skipped in the recurring schedule."
            valueFormat="MMM D, YYYY"
            type="multiple"
            placeholder="Click to select dates to exclude"
            clearable
            valueFormatter={valueFormatter}
            {...form.getInputProps("repeatExcludes")}
          />
        </>
      )}

      <TextInput
        label="Paid Event ID"
        description="For integration with ACM ticketing only."
        placeholder="Enter Ticketing or Merch ID"
        {...form.getInputProps("paidEventId")}
      />

      <Box my="md">
        <Title order={5}>Metadata</Title>
        <Group justify="space-between" mb="xs">
          <Button
            size="xs"
            variant="outline"
            leftSection={<IconPlus size={16} />}
            onClick={addMetadataField}
            disabled={
              Object.keys(form.values.metadata || {}).length >=
              MAX_METADATA_KEYS
            }
          >
            Add Field
          </Button>
        </Group>
        <Text size="xs" c="dimmed">
          These values can be accessed via the API. Max {MAX_KEY_LENGTH}{" "}
          characters for keys and {MAX_VALUE_LENGTH} characters for values.
        </Text>

        {metadataEntries.map(({ id, key, value }) => {
          const keyError = key.trim() === "" ? "Key is required" : undefined;
          const valueError =
            value.trim() === "" ? "Value is required" : undefined;

          return (
            <Group key={id} align="start" gap="sm">
              <TextInput
                label="Key"
                value={key}
                onChange={(e) => updateMetadataKey(id, e.currentTarget.value)}
                error={keyError}
                style={{ flex: 1 }}
              />

              <Box style={{ flex: 1 }}>
                <TextInput
                  label="Value"
                  value={value}
                  onChange={(e) =>
                    updateMetadataValue(id, e.currentTarget.value)
                  }
                  error={valueError}
                />
                {valueError && <div style={{ height: "0.75rem" }} />}
              </Box>

              <ActionIcon
                color="red"
                variant="light"
                onClick={() => removeMetadataField(id)}
                mt={30}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
          );
        })}

        {Object.keys(form.values.metadata || {}).length > 0 && (
          <Box mt="xs" size="xs" ta="right">
            <small>
              {Object.keys(form.values.metadata || {}).length} of{" "}
              {MAX_METADATA_KEYS} fields used
            </small>
          </Box>
        )}
      </Box>

      <Button mt="md" disabled={isSubmitting} onClick={onSubmit}>
        {isSubmitting ? (
          <>
            <Loader size={16} color="white" />
            Submitting...
          </>
        ) : (
          `${isEditing ? "Save" : "Create"} Event`
        )}
      </Button>
    </>
  );
};

export const ManageEventPage: React.FC = () => {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<string | null>("template");
  const [selectedTemplate, setSelectedTemplate] = useState<
    keyof typeof EVENT_TEMPLATES | null
  >(null);
  const [templateUsedForSubmission, setTemplateUsedForSubmission] = useState<
    keyof typeof EVENT_TEMPLATES | null
  >(null);
  const navigate = useNavigate();
  const api = useApi("core");
  const { orgRoles } = useAuth();
  const userPrimaryOrg = getPrimarySuggestedOrg(orgRoles);

  const { eventId } = useParams();

  const isEditing = eventId !== undefined;

  useEffect(() => {
    if (!isEditing) {
      setIsLoading(false);
      return;
    }
    const getEvent = async () => {
      try {
        const response = await api.get(
          `/api/v1/events/${eventId}?ts=${Date.now()}&includeMetadata=true`,
        );
        const eventData = response.data;

        const formValues = {
          title: eventData.title,
          description: eventData.description,
          start: new Date(eventData.start),
          end: eventData.end ? new Date(eventData.end) : undefined,
          location: eventData.location,
          locationLink: eventData.locationLink,
          host: eventData.host,
          featured: eventData.featured,
          repeats: eventData.repeats,
          repeatEnds: eventData.repeatEnds
            ? new Date(eventData.repeatEnds)
            : undefined,
          paidEventId: eventData.paidEventId,
          repeatExcludes:
            eventData.repeatExcludes && eventData.repeatExcludes.length > 0
              ? eventData.repeatExcludes.map((dateString: string) =>
                  moment.tz(dateString, "America/Chicago").toDate(),
                )
              : undefined,
          metadata: eventData.metadata || {},
        };
        form.setValues(formValues);
        setIsLoading(false);
      } catch (error) {
        console.error("Error fetching event data:", error);
        notifications.show({
          title: "Failed to fetch event data",
          message: "Please try again or contact support.",
          color: "red",
          icon: <IconAlertCircle size={16} />,
        });
      }
    };
    getEvent();
  }, [eventId, isEditing]);

  const startDate = new Date().setMinutes(0);
  const form = useForm<EventPostRequest>({
    validate: zodResolver(requestBodySchema),
    initialValues: {
      title: "",
      description: "",
      start: new Date(startDate),
      end: new Date(startDate + 3.6e6),
      location: "ACM Room (Siebel CS 1104)",
      locationLink: "https://maps.app.goo.gl/dwbBBBkfjkgj8gvA8",
      host: userPrimaryOrg || "",
      featured: false,
      repeats: undefined,
      repeatEnds: undefined,
      paidEventId: undefined,
      metadata: {},
      repeatExcludes: [],
    },
  });

  const applyTemplate = (templateKey: keyof typeof EVENT_TEMPLATES) => {
    const template = EVENT_TEMPLATES[templateKey];
    const startDate = new Date().setMinutes(0);
    const primaryOrg = getPrimarySuggestedOrg(orgRoles);

    // Template variables to replace
    const variables = {
      PRIMARY_ORG: primaryOrg || "ACM",
    };

    // Apply template defaults with variable substitution
    const processedDefaults = Object.entries(template.defaults).reduce(
      (acc, [key, value]) => {
        if (typeof value === "string") {
          acc[key] = applyTemplateVariables(value, variables);
        } else {
          acc[key] = value;
        }
        return acc;
      },
      {} as Record<string, any>,
    );

    form.setValues({
      ...form.values,
      host: primaryOrg || "",
      ...processedDefaults,
      start: new Date(startDate),
      end: new Date(startDate + 3.6e6),
    });

    setSelectedTemplate(templateKey);
    setTemplateUsedForSubmission(templateKey);
    setActiveTab("scratch");
    notifications.show({
      title: "Template applied!",
      message: `${template.name} template loaded. Fill in the remaining details.`,
      icon: <IconSparkles size={16} />,
    });
  };

  useEffect(() => {
    if (form.values.end && form.values.end <= form.values.start) {
      form.setFieldValue("end", new Date(form.values.start.getTime() + 3.6e6));
    }
  }, [form.values.start]);

  useEffect(() => {
    if (form.values.locationLink === "") {
      form.setFieldValue("locationLink", undefined);
    }
  }, [form.values.locationLink]);

  const handleSubmit = async () => {
    if (isSubmitting) {
      return;
    }
    const result = form.validate();
    if (result.hasErrors) {
      console.warn(result.errors);

      // Check for forbidden patterns and show specific warning
      const forbiddenFields: string[] = [];
      const forbiddenMatches: Record<string, string[]> = {};

      if (containsForbiddenPattern(form.values.title)) {
        forbiddenFields.push("title");
        forbiddenMatches.title = findForbiddenMatches(form.values.title);
      }
      if (containsForbiddenPattern(form.values.description)) {
        forbiddenFields.push("description");
        forbiddenMatches.description = findForbiddenMatches(
          form.values.description,
        );
      }
      if (containsForbiddenPattern(form.values.location)) {
        forbiddenFields.push("location");
        forbiddenMatches.location = findForbiddenMatches(form.values.location);
      }

      if (forbiddenFields.length > 0) {
        notifications.show({
          title: "Template placeholders not replaced",
          message: (
            <Box>
              <Text size="sm">
                The following fields contain unreplaced template placeholders:
              </Text>
              <List size="sm" mt="xs">
                {forbiddenFields.map((field) => (
                  <List.Item key={field}>
                    <strong>{capitalizeFirstLetter(field)}</strong>:{" "}
                    {forbiddenMatches[field].join(", ")}
                  </List.Item>
                ))}
              </List>
            </Box>
          ),
          color: "red",
          icon: <IconAlertCircle size={16} />,
          autoClose: 8000,
        });
      } else {
        notifications.show({
          title: "Validation failed",
          message: "Please review the errors and try again.",
          color: "red",
          icon: <IconAlertCircle size={16} />,
        });
      }
      return;
    }
    const values = form.values;
    try {
      setIsSubmitting(true);

      // Add templateUsed to metadata if a template was used
      const metadataWithTemplate = templateUsedForSubmission
        ? {
            ...(values.metadata || {}),
            templateUsed: templateUsedForSubmission,
          }
        : values.metadata;

      const realValues = {
        ...values,
        start: dayjs(values.start).format("YYYY-MM-DD[T]HH:mm:00"),
        end: values.end
          ? dayjs(values.end).format("YYYY-MM-DD[T]HH:mm:00")
          : undefined,
        repeatEnds:
          values.repeatEnds && values.repeats
            ? dayjs(values.repeatEnds).format("YYYY-MM-DD[T]HH:mm:00")
            : undefined,
        repeatExcludes:
          values.repeatExcludes && values.repeatExcludes.length > 0
            ? values.repeatExcludes.map((x) => dayjs(x).format("YYYY-MM-DD"))
            : undefined,
        repeats: values.repeats ? values.repeats : undefined,
        metadata:
          Object.keys(metadataWithTemplate || {}).length > 0
            ? metadataWithTemplate
            : undefined,
      };
      const eventURL = isEditing
        ? `/api/v1/events/${eventId}`
        : "/api/v1/events";
      if (isEditing) {
        await api.patch(eventURL, realValues);
      } else {
        await api.post(eventURL, realValues);
      }
      notifications.show({
        title: isEditing ? "Event updated!" : "Event created!",
        message: `Changes may take up to ${Math.ceil(EVENT_CACHED_DURATION / 60)} minutes to reflect to users.`,
      });
      navigate("/events/manage");
    } catch (error) {
      setIsSubmitting(false);
      console.error("Error creating/editing event:", error);
      notifications.show({
        message: "Failed to create/edit event, please try again.",
      });
    }
  };

  if (isLoading) {
    return <FullScreenLoader />;
  }

  return (
    <AuthGuard
      resourceDef={{ service: "core", validRoles: [AppRoles.EVENTS_MANAGER] }}
    >
      <Box maw={600} mx="auto" mt="sm">
        <Title order={2}>{isEditing ? `Edit` : `Create`} Event</Title>
        {eventId && (
          <Text size="xs" c="dimmed" mb="md">
            Event ID: <code>{eventId}</code>
          </Text>
        )}

        {!isEditing ? (
          <Tabs value={activeTab} onChange={setActiveTab} mb="md">
            <Tabs.List>
              <Tabs.Tab value="template">From Template</Tabs.Tab>
              <Tabs.Tab value="scratch">From Scratch</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="scratch" pt="md">
              <EventFormComponent
                form={form}
                selectedTemplate={selectedTemplate}
                isSubmitting={isSubmitting}
                isEditing={isEditing}
                onSetSelectedTemplate={setSelectedTemplate}
                onSubmit={handleSubmit}
              />
            </Tabs.Panel>

            <Tabs.Panel value="template" pt="md">
              <Stack gap="md">
                <Text size="sm" c="dimmed">
                  Choose a template to get started quickly. Templates pre-fill
                  common fields based on the event type.
                </Text>

                <SimpleGrid cols={2} spacing="md">
                  {Object.entries(EVENT_TEMPLATES).map(([key, template]) => (
                    <Card
                      key={key}
                      shadow="sm"
                      padding="lg"
                      radius="md"
                      withBorder
                      style={{ cursor: "pointer" }}
                      onClick={() =>
                        applyTemplate(key as keyof typeof EVENT_TEMPLATES)
                      }
                    >
                      <Stack gap="xs">
                        <Group justify="space-between">
                          <Text fw={500}>{template.name}</Text>
                          <IconSparkles size={20} />
                        </Group>
                        <Text size="sm" c="dimmed">
                          {template.description}
                        </Text>
                      </Stack>
                    </Card>
                  ))}
                </SimpleGrid>
              </Stack>
            </Tabs.Panel>
          </Tabs>
        ) : (
          <EventFormComponent
            form={form}
            selectedTemplate={selectedTemplate}
            isSubmitting={isSubmitting}
            isEditing={isEditing}
            onSetSelectedTemplate={setSelectedTemplate}
            onSubmit={handleSubmit}
          />
        )}
      </Box>
    </AuthGuard>
  );
};
