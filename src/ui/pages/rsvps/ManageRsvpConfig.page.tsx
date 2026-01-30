import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Container, Title, Button, Group, Accordion } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import { AuthGuard } from "@ui/components/AuthGuard";
import { useApi } from "@ui/util/api";
import { AppRoles } from "@common/roles.js";
import { RsvpConfigForm } from "./ManageRsvpConfigForm";
import { RsvpAnalyticsView } from "./RsvpAnalyticsView";
import * as z from "zod/v4";

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

const rsvpSchema = z.object({
  eventId: z.string(),
  userId: z.string(),
  isPaidMember: z.boolean(),
  createdAt: z.number(),
});

type RsvpConfigData = z.infer<typeof rsvpConfigSchema>;
type RsvpData = z.infer<typeof rsvpSchema>;

export const ManageRsvpConfigFormPage: React.FC = () => {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const api = useApi("core");

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

        <Title order={1} mb="md">
          Manage RSVP Configuration
        </Title>

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
