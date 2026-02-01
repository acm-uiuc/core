import React, { useEffect, useState } from "react";
import {
  Button,
  Group,
  Box,
  LoadingOverlay,
  Alert,
  Title,
  Text,
  Stack,
  Paper,
  Badge,
  Switch,
  NumberInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { DateTimePicker } from "@mantine/dates";
import { IconDeviceFloppy, IconAlertCircle } from "@tabler/icons-react";
import { zod4Resolver as zodResolver } from "mantine-form-zod-resolver";
import * as z from "zod/v4";

const rsvpConfigSchema = z.object({
  rsvpOpenAt: z.number().min(0).max(9007199254740991),
  rsvpCloseAt: z.number().min(0).max(9007199254740991),
  rsvpLimit: z.number().min(0).max(20000).nullable(),
  rsvpCheckInEnabled: z.boolean().default(false),
});

type RsvpConfigData = z.infer<typeof rsvpConfigSchema>;

interface RsvpConfigFormProps {
  eventId: string;
  getRsvpConfig: (eventId: string) => Promise<RsvpConfigData>;
  updateRsvpConfig: (eventId: string, data: RsvpConfigData) => Promise<void>;
}

export const RsvpConfigForm: React.FC<RsvpConfigFormProps> = ({
  eventId,
  getRsvpConfig,
  updateRsvpConfig,
}) => {
  const [configData, setConfigData] = useState<
    RsvpConfigData | null | undefined
  >(undefined);
  const [loading, setLoading] = useState(false);
  const [noConfigFound, setNoConfigFound] = useState(false);

  const form = useForm({
    validate: zodResolver(rsvpConfigSchema),
    initialValues: {
      rsvpOpenAt: 0,
      rsvpCloseAt: 0,
      rsvpLimit: null,
      rsvpCheckInEnabled: false,
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
      });
    } catch (e: any) {
      console.error("Error fetching RSVP config:", e);

      if (e?.response?.status === 404 || e?.message?.includes("not found")) {
        setConfigData(null);
        setNoConfigFound(true);
        const now = Math.floor(Date.now() / 1000);
        const oneWeekLater = now + 7 * 24 * 60 * 60;

        form.setValues({
          rsvpOpenAt: now,
          rsvpCloseAt: oneWeekLater,
          rsvpLimit: null,
          rsvpCheckInEnabled: false,
        });
      } else {
        // For other errors (like validation), still set to null but don't show "no config" message
        setConfigData(null);
        notifications.show({
          title: "Error loading config",
          message:
            "There was an error loading the RSVP configuration. Please check the console.",
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

    fetchRsvpConfig();
  }, [eventId]);

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
            This event does not have an RSVP configuration yet. You can create
            one by filling out the form below.
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
                const timestamp = Math.floor(
                  Date.parse(date.toString()) / 1000,
                );
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
                const timestamp = Math.floor(
                  Date.parse(date.toString()) / 1000,
                );
                if (isNaN(timestamp)) {
                  notifications.show({
                    title: "Invalid Date",
                    message: "Please select a valid date and time.",
                    color: "red",
                  });
                  return;
                }
                // Validate that close date is after open date
                if (
                  form.values.rsvpOpenAt &&
                  timestamp <= form.values.rsvpOpenAt
                ) {
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
            minDate={
              form.values.rsvpOpenAt
                ? new Date(form.values.rsvpOpenAt * 1000)
                : new Date()
            }
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
              form.setFieldValue(
                "rsvpLimit",
                typeof value === "number" ? value : null,
              );
            }}
            mb="md"
          />

          <Switch
            label="Enable Check-In"
            description="Allow attendees to check in at the event"
            checked={form.values.rsvpCheckInEnabled}
            onChange={(event) =>
              form.setFieldValue(
                "rsvpCheckInEnabled",
                event.currentTarget.checked,
              )
            }
            mb="md"
          />
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
