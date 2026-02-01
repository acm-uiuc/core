import React, { useEffect, useCallback, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Container, Title, Button, Group, Accordion } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowLeft, IconQrcode } from "@tabler/icons-react";
import { AuthGuard } from "@ui/components/AuthGuard";
import { useApi } from "@ui/util/api";
import { AppRoles } from "@common/roles.js";
import { RsvpConfigForm } from "./ManageRsvpConfigForm";
import { RsvpAnalyticsView } from "./RsvpAnalyticsView";
import { CheckInModal } from "./CheckInModal";
import { rsvpConfigSchema, rsvpItemSchema } from "../../../common/types/rsvp";
import * as z from "zod/v4";

const rsvpConfigSchemaFrontend = z.object({
  rsvpOpenAt: z.number().min(0).max(9007199254740991),
  rsvpCloseAt: z.number().min(0).max(9007199254740991),
  rsvpLimit: z.number().min(1).max(20000).nullable(),
  rsvpCheckInEnabled: z.boolean().default(false),
});

type RsvpConfigData = z.infer<typeof rsvpConfigSchemaFrontend>;
type RsvpData = z.infer<typeof rsvpItemSchema>;

export const ManageRsvpConfigFormPage: React.FC = () => {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const api = useApi("core");
  const [checkInModalOpened, setCheckInModalOpened] = useState(false);
  const [hasRsvpConfig, setHasRsvpConfig] = useState(false);
  const [checkInEnabled, setCheckInEnabled] = useState(false);

  const checkRsvpConfigExists = useCallback(async () => {
    try {
      const response = await api.get(`/api/v1/rsvp/event/${eventId}/config`);
      const config = rsvpConfigSchemaFrontend.parse(response.data);
      setHasRsvpConfig(true);
      setCheckInEnabled(config.rsvpCheckInEnabled);
    } catch (error: any) {
      console.error("Error checking RSVP config:", error);
      if (error?.response?.status === 404) {
        setHasRsvpConfig(false);
        setCheckInEnabled(false);
      } else {
        notifications.show({
          title: "Error loading RSVP config",
          message: "Unable to determine RSVP settings. Please try again.",
          color: "red",
        });
      }
    }
  }, [api, eventId]);

  useEffect(() => {
    if (eventId) {
      checkRsvpConfigExists();
    }
  }, [eventId, checkRsvpConfigExists]);

  const getRsvpConfig = async (eventId: string): Promise<RsvpConfigData> => {
    const response = await api.get(`/api/v1/rsvp/event/${eventId}/config`);
    return rsvpConfigSchemaFrontend.parse(response.data);
  };

  const updateRsvpConfig = async (
    eventId: string,
    data: RsvpConfigData,
  ): Promise<void> => {
    await api.post(`/api/v1/rsvp/event/${eventId}/config`, data);
  };

  const getRsvps = async (eventId: string): Promise<RsvpData[]> => {
    const response = await api.get(`/api/v1/rsvp/event/${eventId}`);
    return z.array(rsvpItemSchema).parse(response.data);
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
