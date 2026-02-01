import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Container, Title, Button, Group, Accordion } from "@mantine/core";
import { IconArrowLeft, IconQrcode } from "@tabler/icons-react";
import { AuthGuard } from "@ui/components/AuthGuard";
import { useApi } from "@ui/util/api";
import { AppRoles } from "@common/roles.js";
import { RsvpConfigForm } from "./ManageRsvpConfigForm";
import { RsvpAnalyticsView } from "./RsvpAnalyticsView";
import { CheckInModal } from "./CheckInModal";
import * as z from "zod/v4";

const rsvpConfigSchema = z.object({
  rsvpOpenAt: z.number().min(0).max(9007199254740991),
  rsvpCloseAt: z.number().min(0).max(9007199254740991),
  rsvpLimit: z.number().min(0).max(20000).nullable(),
  rsvpCheckInEnabled: z.boolean().default(false),
});

const rsvpSchema = z.object({
  eventId: z.string(),
  userId: z.string(),
  isPaidMember: z.boolean(),
  checkedIn: z.boolean(),
  createdAt: z.number(),
  schoolYear: z.string(),
  intendedMajor: z.string(),
  dietaryRestrictions: z.array(z.string()),
  interests: z.array(z.string()),
});

type RsvpConfigData = z.infer<typeof rsvpConfigSchema>;
type RsvpData = z.infer<typeof rsvpSchema>;

export const ManageRsvpConfigFormPage: React.FC = () => {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const api = useApi("core");
  const [checkInModalOpened, setCheckInModalOpened] = useState(false);
  const [hasRsvpConfig, setHasRsvpConfig] = useState(false);
  const [checkInEnabled, setCheckInEnabled] = useState(false);

  useEffect(() => {
    if (eventId) {
      checkRsvpConfigExists();
    }
  }, [eventId]);

  const checkRsvpConfigExists = async () => {
    try {
      const response = await api.get(`/api/v1/rsvp/event/${eventId}/config`);
      const config = rsvpConfigSchema.parse(response.data);
      setHasRsvpConfig(true);
      setCheckInEnabled(config.rsvpCheckInEnabled);
    } catch (error) {
      console.error("Error checking RSVP config:", error);
      setHasRsvpConfig(false);
      setCheckInEnabled(false);
    }
  };

  const getRsvpConfig = async (eventId: string): Promise<RsvpConfigData> => {
    const response = await api.get(`/api/v1/rsvp/event/${eventId}/config`);
    return rsvpConfigSchema.parse(response.data);
  };

  const updateRsvpConfig = async (
    eventId: string,
    data: RsvpConfigData,
  ): Promise<void> => {
    await api.post(`/api/v1/rsvp/event/${eventId}/config`, data);
  };

  const getRsvps = async (eventId: string): Promise<RsvpData[]> => {
    const response = await api.get(`/api/v1/rsvp/event/${eventId}`);
    return z.array(rsvpSchema).parse(response.data);
  };

  const checkInAttendee = async (
    eventId: string,
    userId: string,
  ): Promise<void> => {
    await api.post(`/api/v1/rsvp/checkin/event/${eventId}/attendee/${userId}`);
  };

  if (!eventId) {
    return (
      <Container>
        <Title order={1}>Error</Title>
        <p>No event ID provided</p>
      </Container>
    );
  }

  return (
    <AuthGuard
      resourceDef={{ service: "core", validRoles: [AppRoles.RSVP_MANAGER] }}
    >
      <Container size="lg">
        <Group mb="xl">
          <Button
            variant="subtle"
            leftSection={<IconArrowLeft size={16} />}
            onClick={() => navigate(-1)}
          >
            Back
          </Button>
        </Group>

        <Group justify="space-between" align="center" mb="md">
          <Title order={1}>Manage RSVP Configuration</Title>
          {hasRsvpConfig && checkInEnabled && (
            <Button
              leftSection={<IconQrcode size={16} />}
              onClick={() => setCheckInModalOpened(true)}
              color="green"
            >
              Check-In Attendees
            </Button>
          )}
        </Group>

        <CheckInModal
          opened={checkInModalOpened}
          onClose={() => setCheckInModalOpened(false)}
          eventId={eventId}
          checkInAttendee={checkInAttendee}
        />

        <Accordion defaultValue="configuration" variant="separated">
          <Accordion.Item value="configuration">
            <Accordion.Control>
              <Title order={3}>RSVP Configuration</Title>
            </Accordion.Control>
            <Accordion.Panel>
              <RsvpConfigForm
                eventId={eventId}
                getRsvpConfig={getRsvpConfig}
                updateRsvpConfig={updateRsvpConfig}
              />
            </Accordion.Panel>
          </Accordion.Item>

          <Accordion.Item value="analytics">
            <Accordion.Control>
              <Title order={3}>Response Analytics</Title>
            </Accordion.Control>
            <Accordion.Panel>
              <RsvpAnalyticsView eventId={eventId} getRsvps={getRsvps} />
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Container>
    </AuthGuard>
  );
};
