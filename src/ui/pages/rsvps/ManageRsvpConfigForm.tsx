import React, { useEffect, useState } from "react";
import {
  TextInput,
  Button,
  Group,
  Box,
  LoadingOverlay,
  Alert,
  Title,
  Text,
  ActionIcon,
  Stack,
  Paper,
  Badge,
  Switch,
  NumberInput,
  Select,
  List,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { DateTimePicker } from "@mantine/dates";
import {
  IconPlus,
  IconTrash,
  IconDeviceFloppy,
  IconAlertCircle,
} from "@tabler/icons-react";
import { zod4Resolver as zodResolver } from "mantine-form-zod-resolver";
import * as z from "zod/v4";
import { ResponsiveTable, Column } from "@ui/components/ResponsiveTable";
import dayjs from "dayjs";

const questionTypes = ["TEXT", "MCQ", "MCQM"] as const;

const rsvpQuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  type: z.string(),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
});

const rsvpConfigSchema = z.object({
  rsvpOpenAt: z.number().min(0).max(9007199254740991),
  rsvpCloseAt: z.number().min(0).max(9007199254740991),
  rsvpLimit: z.number().min(0).max(20000).nullable(),
  rsvpCheckInEnabled: z.boolean().default(false),
  rsvpQuestions: z.array(rsvpQuestionSchema).default([]),
});

type RsvpConfigData = z.infer<typeof rsvpConfigSchema>;
type RsvpQuestion = z.infer<typeof rsvpQuestionSchema>;

interface RsvpConfigFormProps {
  eventId: string;
  getRsvpConfig: (eventId: string) => Promise<RsvpConfigData>;
  updateRsvpConfig: (eventId: string, data: RsvpConfigData) => Promise<void>;
}

interface DisplayQuestion extends RsvpQuestion {
  isNew: boolean;
}

export const RsvpConfigForm: React.FC<RsvpConfigFormProps> = ({
  eventId,
  getRsvpConfig,
  updateRsvpConfig,
}) => {
  const [configData, setConfigData] = useState<RsvpConfigData | null | undefined>(
    undefined,
  );
  const [loading, setLoading] = useState(false);
  const [noConfigFound, setNoConfigFound] = useState(false);

  // New question form state
  const [newQuestionId, setNewQuestionId] = useState("");
  const [newQuestionPrompt, setNewQuestionPrompt] = useState("");
  const [newQuestionType, setNewQuestionType] = useState<string>("TEXT");
  const [newQuestionRequired, setNewQuestionRequired] = useState(false);
  const [newQuestionOptions, setNewQuestionOptions] = useState<string[]>([]);
  const [optionInput, setOptionInput] = useState("");

  const form = useForm({
    validate: zodResolver(rsvpConfigSchema),
    initialValues: {
      rsvpOpenAt: 0,
      rsvpCloseAt: 0,
      rsvpLimit: null,
      rsvpCheckInEnabled: false,
      rsvpQuestions: [],
    } as RsvpConfigData,
  });

  const fetchRsvpConfig = async () => {
    setLoading(true);
    setNoConfigFound(false);
    try {
      const data = await getRsvpConfig(eventId);
      setConfigData(data);

      form.setValues({
        rsvpOpenAt: data.rsvpOpenAt,
        rsvpCloseAt: data.rsvpCloseAt,
        rsvpLimit: data.rsvpLimit,
        rsvpCheckInEnabled: data.rsvpCheckInEnabled,
        rsvpQuestions: data.rsvpQuestions || [],
      });
    } catch (e: any) {
      console.error("Error fetching RSVP config:", e);
      
      // Only show "no config found" for actual 404/not found errors
      // If it's a validation error or other issue, log it but don't show the alert
      if (e?.response?.status === 404 || e?.message?.includes("not found")) {
        setConfigData(null);
        setNoConfigFound(true);
        
        // Set default values when no config is found
        const now = Math.floor(Date.now() / 1000);
        const oneWeekLater = now + 7 * 24 * 60 * 60;
        
        form.setValues({
          rsvpOpenAt: now,
          rsvpCloseAt: oneWeekLater,
          rsvpLimit: null,
          rsvpCheckInEnabled: false,
          rsvpQuestions: [],
        });
      } else {
        // For other errors (like validation), still set to null but don't show "no config" message
        setConfigData(null);
        notifications.show({
          title: "Error loading config",
          message: "There was an error loading the RSVP configuration. Please check the console.",
          color: "red",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setConfigData(undefined);
    setLoading(false);
    setNoConfigFound(false);
    form.reset();
    setNewQuestionId("");
    setNewQuestionPrompt("");
    setNewQuestionType("TEXT");
    setNewQuestionRequired(false);
    setNewQuestionOptions([]);
    setOptionInput("");

    fetchRsvpConfig();
  }, [eventId]);

  const handleAddQuestion = () => {
    if (!newQuestionId.trim() || !newQuestionPrompt.trim()) {
      notifications.show({
        title: "Invalid Input",
        message: "Question ID and prompt are required.",
        color: "orange",
      });
      return;
    }

    // Validate options for MCQ types
    if ((newQuestionType === "MCQ" || newQuestionType === "MCQM") && newQuestionOptions.length === 0) {
      notifications.show({
        title: "Invalid Input",
        message: "Multiple choice questions require at least one option.",
        color: "orange",
      });
      return;
    }

    // Check for duplicate IDs
    if (form.values.rsvpQuestions.some((q) => q.id === newQuestionId.trim())) {
      notifications.show({
        title: "Duplicate ID",
        message: "A question with this ID already exists.",
        color: "orange",
      });
      return;
    }

    const newQuestion: any = {
      id: newQuestionId.trim(),
      prompt: newQuestionPrompt.trim(),
      type: newQuestionType,
      required: newQuestionRequired,
    };

    // Add options only for MCQ types
    if (newQuestionType === "MCQ" || newQuestionType === "MCQM") {
      newQuestion.options = newQuestionOptions;
    }

    form.insertListItem("rsvpQuestions", newQuestion);

    setNewQuestionId("");
    setNewQuestionPrompt("");
    setNewQuestionType("TEXT");
    setNewQuestionRequired(false);
    setNewQuestionOptions([]);
    setOptionInput("");
  };

  const removeQuestion = (index: number) => {
    form.removeListItem("rsvpQuestions", index);
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const values = form.values;

      // Validate that close time is after open time
      if (values.rsvpCloseAt <= values.rsvpOpenAt) {
        notifications.show({
          title: "Invalid Times",
          message: "RSVP close time must be after open time.",
          color: "red",
        });
        setLoading(false);
        return;
      }

      await updateRsvpConfig(eventId, values);
      
      notifications.show({
        title: "Success",
        message: "RSVP configuration saved successfully.",
        color: "green",
      });
      
      // Refresh data
      await fetchRsvpConfig();
    } catch (e) {
      console.error(e);
      notifications.show({
        title: "Error",
        message: "Failed to save RSVP configuration.",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  // Define columns for questions table
  const questionsColumns: Column<RsvpQuestion>[] = [
    {
      key: "id",
      label: "ID",
      isPrimaryColumn: true,
      render: (question) => (
        <Text size="sm" fw={500}>
          {question.id}
        </Text>
      ),
    },
    {
      key: "prompt",
      label: "Question",
      render: (question) => question.prompt,
    },
    {
      key: "type",
      label: "Type",
      render: (question) => {
        let label = "Free Response";
        let color = "blue";
        
        if (question.type === "MCQ") {
          label = "Multiple Choice";
          color = "green";
        } else if (question.type === "MCQM") {
          label = "Multi-Select";
          color = "violet";
        }
        
        return (
          <Badge color={color} variant="light">
            {label}
          </Badge>
        );
      },
    },
    {
      key: "details",
      label: "Details",
      render: (question) => {
        if ((question.type === "MCQ" || question.type === "MCQM") && question.options) {
          return (
            <Box>
              <Text size="xs" c="dimmed" mb={4}>Options:</Text>
              <List size="xs" spacing={2}>
                {question.options.map((opt, idx) => (
                  <List.Item key={idx}>{opt}</List.Item>
                ))}
              </List>
            </Box>
          );
        }
        return <Text size="xs" c="dimmed">Text response</Text>;
      },
    },
    {
      key: "required",
      label: "Required",
      render: (question) => (
        <Badge color={question.required ? "blue" : "gray"} variant="light">
          {question.required ? "Required" : "Optional"}
        </Badge>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      hideMobileLabel: true,
      render: (question) => {
        const index = form.values.rsvpQuestions.findIndex((q) => q.id === question.id);
        return (
          <Button
            color="red"
            variant="light"
            size="xs"
            leftSection={<IconTrash size={14} />}
            onClick={(e) => {
              e.stopPropagation();
              removeQuestion(index);
            }}
          >
            Remove
          </Button>
        );
      },
    },
  ];

  if (configData === undefined) {
    return <LoadingOverlay visible data-testid="rsvp-config-loading" />;
  }

  return (
    <Box>
      {noConfigFound && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="blue"
          variant="light"
          mb="md"
        >
          <Text size="sm" fw={500} mb={4}>
            No RSVP Configuration Found
          </Text>
          <Text size="sm">
            This event does not have an RSVP configuration yet. You can create one by filling out the form below.
          </Text>
        </Alert>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <Paper withBorder p="md" mb="md">
          <Title order={4} mb="md">
            RSVP Timing
          </Title>

          <DateTimePicker
            label="RSVP Opens At"
            description="When users can start RSVPing for this event"
            placeholder="Select date and time"
            value={
              form.values.rsvpOpenAt
                ? new Date(form.values.rsvpOpenAt * 1000)
                : null
            }
            onChange={(date) => {
              if (date) {
                const timestamp = Math.floor(Date.parse(date.toString()) / 1000);
                if (isNaN(timestamp)) {
                  notifications.show({
                    title: "Invalid Date",
                    message: "Please select a valid date and time.",
                    color: "red",
                  });
                  return;
                }
                form.setFieldValue("rsvpOpenAt", timestamp);
              }
            }}
            mb="md"
            required
            minDate={new Date()}
          />

          <DateTimePicker
            label="RSVP Closes At"
            description="Deadline for users to RSVP"
            placeholder="Select date and time"
            value={
              form.values.rsvpCloseAt
                ? new Date(form.values.rsvpCloseAt * 1000)
                : null
            }
            onChange={(date) => {
              if (date) {
                const timestamp = Math.floor(Date.parse(date.toString()) / 1000);
                if (isNaN(timestamp)) {
                  notifications.show({
                    title: "Invalid Date",
                    message: "Please select a valid date and time.",
                    color: "red",
                  });
                  return;
                }
                // Validate that close date is after open date
                if (form.values.rsvpOpenAt && timestamp <= form.values.rsvpOpenAt) {
                  notifications.show({
                    title: "Invalid Date",
                    message: "Close date must be after open date.",
                    color: "red",
                  });
                  return;
                }
                form.setFieldValue("rsvpCloseAt", timestamp);
              }
            }}
            mb="md"
            required
            minDate={form.values.rsvpOpenAt ? new Date(form.values.rsvpOpenAt * 1000) : new Date()}
          />
        </Paper>

        <Paper withBorder p="md" mb="md">
          <Title order={4} mb="md">
            RSVP Settings
          </Title>

          <NumberInput
            label="RSVP Limit"
            description="Maximum number of attendees (leave empty for unlimited)"
            placeholder="No limit"
            min={0}
            max={20000}
            clampBehavior="strict"
            allowNegative={false}
            value={form.values.rsvpLimit ?? undefined}
            onChange={(value) => {
              if (typeof value === "number" && value < 0) {
                return; // Prevent negative values
              }
              form.setFieldValue("rsvpLimit", typeof value === "number" ? value : null);
            }}
            mb="md"
          />

          <Switch
            label="Enable Check-In"
            description="Allow attendees to check in at the event"
            checked={form.values.rsvpCheckInEnabled}
            onChange={(event) =>
              form.setFieldValue("rsvpCheckInEnabled", event.currentTarget.checked)
            }
            mb="md"
          />
        </Paper>

        <Paper withBorder p="md" mb="md">
          <Group justify="space-between" mb="sm">
            <div>
              <Title order={4}>Custom Questions</Title>
              <Text size="sm" c="dimmed">
                Add custom questions to ask users during RSVP
              </Text>
            </div>
          </Group>

          {form.values.rsvpQuestions.length > 0 ? (
            <Box mb="md">
              <ResponsiveTable
                data={form.values.rsvpQuestions}
                columns={questionsColumns}
                keyExtractor={(question) => question.id}
                testIdPrefix="question-row"
                cardColumns={{ base: 1 }}
              />
            </Box>
          ) : (
            <Text size="sm" c="dimmed" ta="center" py="md">
              No custom questions added yet.
            </Text>
          )}

          <Stack gap="xs" mt="md">
            <TextInput
              label="Question ID"
              description="Unique identifier for this question (e.g., 'dietary', 'tshirt-size')"
              placeholder="dietary"
              value={newQuestionId}
              onChange={(e) => setNewQuestionId(e.currentTarget.value)}
            />

            <TextInput
              label="Question Prompt"
              description="The question to ask the user"
              placeholder="Do you have any dietary restrictions?"
              value={newQuestionPrompt}
              onChange={(e) => setNewQuestionPrompt(e.currentTarget.value)}
            />

            <Select
              label="Question Type"
              description="Choose the type of response"
              data={[
                { value: "TEXT", label: "Free Response (Text)" },
                { value: "MCQ", label: "Multiple Choice (Single)" },
                { value: "MCQM", label: "Multiple Choice (Multi-Select)" },
              ]}
              value={newQuestionType}
              onChange={(value) => {
                setNewQuestionType(value || "TEXT");
                // Clear options if switching away from MCQ types
                if (value === "TEXT") {
                  setNewQuestionOptions([]);
                }
              }}
            />

            {(newQuestionType === "MCQ" || newQuestionType === "MCQM") && (
              <Paper withBorder p="sm" bg="gray.0">
                <Text size="sm" fw={500} mb="xs">
                  Options
                </Text>
                {newQuestionOptions.length > 0 && (
                  <Stack gap={4} mb="xs">
                    {newQuestionOptions.map((option, idx) => (
                      <Group key={idx} gap="xs">
                        <Badge variant="light">{option}</Badge>
                        <ActionIcon
                          size="xs"
                          color="red"
                          variant="subtle"
                          onClick={() => {
                            setNewQuestionOptions((prev) =>
                              prev.filter((_, i) => i !== idx)
                            );
                          }}
                        >
                          <IconTrash size={12} />
                        </ActionIcon>
                      </Group>
                    ))}
                  </Stack>
                )}
                <Group gap="xs">
                  <TextInput
                    placeholder="Add an option"
                    value={optionInput}
                    onChange={(e) => setOptionInput(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && optionInput.trim()) {
                        e.preventDefault();
                        setNewQuestionOptions((prev) => [...prev, optionInput.trim()]);
                        setOptionInput("");
                      }
                    }}
                    style={{ flex: 1 }}
                  />
                  <Button
                    size="xs"
                    onClick={() => {
                      if (optionInput.trim()) {
                        setNewQuestionOptions((prev) => [...prev, optionInput.trim()]);
                        setOptionInput("");
                      }
                    }}
                    disabled={!optionInput.trim()}
                  >
                    Add
                  </Button>
                </Group>
              </Paper>
            )}

            <Switch
              label="Required"
              description="Make this question required for RSVP"
              checked={newQuestionRequired}
              onChange={(e) => setNewQuestionRequired(e.currentTarget.checked)}
            />
          </Stack>

          <Button
            mt="md"
            leftSection={<IconPlus size={16} />}
            onClick={handleAddQuestion}
            disabled={loading}
            variant="light"
          >
            Add Question
          </Button>
        </Paper>

        <Group mt="md">
          <Button
            type="submit"
            loading={loading}
            disabled={loading}
            leftSection={<IconDeviceFloppy size={16} color="white" />}
          >
            Save Configuration
          </Button>
        </Group>
      </form>
    </Box>
  );
};