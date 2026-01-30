import {
  Text,
  Button,
  Modal,
  Group,
  Title,
  Badge,
  Anchor,
  Divider,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconSettings } from "@tabler/icons-react";
import dayjs from "dayjs";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { capitalizeFirstLetter } from "../events/ManageEvent.page.js";
import FullScreenLoader from "@ui/components/AuthContext/LoadingScreen";
import { AuthGuard } from "@ui/components/AuthGuard";
import { useApi } from "@ui/util/api";
import { AppRoles } from "@common/roles.js";
import { ResponsiveTable, Column } from "@ui/components/ResponsiveTable";
import * as z from "zod/v4";

const repeatOptions = ["weekly", "biweekly"] as const;

const baseSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  start: z.string(),
  end: z.optional(z.string()),
  location: z.string(),
  locationLink: z.optional(z.string().url()),
  host: z.string(),
  featured: z.boolean().default(false),
  paidEventId: z.optional(z.string().min(1)),
});

const requestSchema = baseSchema.extend({
  repeats: z.optional(z.enum(repeatOptions)),
  repeatEnds: z.string().optional(),
});

const getEventSchema = requestSchema.extend({
  id: z.string(),
  upcoming: z.boolean().optional(),
  hasRsvpConfig: z.boolean().optional(),
});

export type EventGetResponse = z.infer<typeof getEventSchema>;
const getEventsSchema = z.array(getEventSchema);
export type EventsGetResponse = z.infer<typeof getEventsSchema>;

export const ViewRsvpConfigsPage: React.FC = () => {
  const [eventList, setEventList] = useState<EventsGetResponse>([]);
  const api = useApi("core");
  const [showPrevious, { toggle: togglePrevious }] = useDisclosure(false);
  const [selectedEventForRsvp, setSelectedEventForRsvp] =
    useState<EventGetResponse | null>(null);
  const [rsvpNotFoundModalOpened, { open: openRsvpNotFoundModal, close: closeRsvpNotFoundModal }] =
    useDisclosure(false);
  const navigate = useNavigate();

  // Sorted events
  const sortedUpcomingEvents = useMemo(() => {
    return eventList
      .filter((event: EventGetResponse) => event.upcoming)
      .sort(
        (a: EventGetResponse, b: EventGetResponse) =>
          new Date(a.start).getTime() - new Date(b.start).getTime(),
      );
  }, [eventList]);

  const sortedPreviousEvents = useMemo(() => {
    return eventList
      .filter((event: EventGetResponse) => !event.upcoming)
      .sort((a: EventGetResponse, b: EventGetResponse) => {
        if (a.repeatEnds && b.repeatEnds) {
          return (
            new Date(b.repeatEnds).getTime() - new Date(a.repeatEnds).getTime()
          );
        } else if (a.repeatEnds) {
          return -1;
        } else if (b.repeatEnds) {
          return 1;
        }
        return new Date(b.start).getTime() - new Date(a.start).getTime();
      });
  }, [eventList]);

  useEffect(() => {
    const getEvents = async () => {
      try {
        const response = await api.get(`/api/v1/events?ts=${Date.now()}`);
        const upcomingEvents = await api.get(
          `/api/v1/events?upcomingOnly=true&ts=${Date.now()}`,
        );

        const upcomingEventsSet = new Set(
          upcomingEvents.data.map((x: EventGetResponse) => x.id),
        );

        const events = response.data;
        events.sort((a: EventGetResponse, b: EventGetResponse) => {
          return a.start.localeCompare(b.start);
        });

        const enrichedResponse = response.data.map((item: EventGetResponse) => {
          if (upcomingEventsSet.has(item.id)) {
            return { ...item, upcoming: true };
          }
          return { ...item, upcoming: false };
        });

        setEventList(enrichedResponse);
      } catch (error) {
        console.error("Error fetching events:", error);
        notifications.show({
          title: "Error fetching events",
          message: `${error}`,
          color: "red",
        });
      }
    };

    getEvents();
  }, []);

  // Mock function to check for RSVP config - replace with actual logic
  const checkRsvpConfig = async (eventId: string): Promise<boolean> => {
    // TODO: Replace this mock function with actual API call
    const response = await api.get(`/api/v1/rsvp/event/${eventId}/config`);
    if(response.status == 200) {
        return true;
    }    
    return false;
  };

  const handleViewRsvpConfig = async (event: EventGetResponse) => {
    setSelectedEventForRsvp(event);
    
    try {
      const hasConfig = await checkRsvpConfig(event.id);
      
      if (hasConfig) {
        // Navigate to RSVP config page (to be built later)
        navigate(`/rsvps/manage/${event.id}`);
      } else {
        // Show modal asking if user wants to configure RSVP
        openRsvpNotFoundModal();
      }
    } catch (error) {
      openRsvpNotFoundModal();
    }
  };

  const handleConfigureRsvp = () => {
    closeRsvpNotFoundModal();
    // Navigate to RSVP config creation page (to be built later)
    // navigate(`/events/rsvp-config/create/${selectedEventForRsvp?.id}`);
    notifications.show({
      title: "Navigation placeholder",
      message: "Would navigate to create RSVP config page here",
      color: "blue",
    });
  };

  // Define columns for ResponsiveTable
  const columns: Column<EventGetResponse>[] = [
    {
      key: "title",
      label: "Title",
      isPrimaryColumn: true,
      render: (event) => (
        <>
          {event.title}{" "}
          {event.featured ? <Badge color="green">Featured</Badge> : null}
        </>
      ),
    },
    {
      key: "start",
      label: "Start",
      render: (event) => dayjs(event.start).format("MMM D YYYY hh:mm A"),
    },
    {
      key: "end",
      label: "End",
      render: (event) =>
        event.end ? dayjs(event.end).format("MMM D YYYY hh:mm A") : "N/A",
    },
    {
      key: "location",
      label: "Location",
      render: (event) =>
        event.locationLink ? (
          <Anchor target="_blank" size="sm" href={event.locationLink}>
            {event.location}
          </Anchor>
        ) : (
          event.location
        ),
    },
    {
      key: "host",
      label: "Host",
      render: (event) => event.host,
    },
    {
      key: "repeats",
      label: "Repeats",
      render: (event) => capitalizeFirstLetter(event.repeats || "Never"),
    },
    {
      key: "actions",
      label: "Actions",
      hideMobileLabel: true,
      render: (event) => (
        <Button
          component="a"
          leftSection={<IconSettings size={14} />}
          onClick={(e) => {
            e.stopPropagation();
            handleViewRsvpConfig(event);
          }}
        >
          Manage RSVP Config
        </Button>
      ),
    },
  ];

  if (eventList.length === 0) {
    return <FullScreenLoader />;
  }

  return (
    <AuthGuard
      resourceDef={{ service: "core", validRoles: [AppRoles.RSVP_MANAGER] }}
    >
      <Title order={1} mb="md">
        RSVP Configuration Management
      </Title>

      {/* RSVP Config Not Found Modal */}
      <Modal
        opened={rsvpNotFoundModalOpened}
        onClose={closeRsvpNotFoundModal}
        title="RSVP Configuration Not Found"
      >
        <Text mb="md">
          An RSVP configuration was not able to be found for{" "}
          <i>{selectedEventForRsvp?.title}</i>. Would you like to configure one?
        </Text>
        <Group>
          <Button onClick={handleConfigureRsvp} leftSection={<IconSettings size={14} />}>
            Configure RSVP
          </Button>
          <Button variant="outline" onClick={closeRsvpNotFoundModal}>
            Cancel
          </Button>
        </Group>
      </Modal>

      <div
        style={{ display: "flex", columnGap: "1vw", verticalAlign: "middle" }}
      >
        <Button onClick={togglePrevious} variant="outline">
          {showPrevious ? "Hide Previous Events" : "Show Previous Events"}
        </Button>
      </div>

      <ResponsiveTable
        data={sortedUpcomingEvents}
        columns={columns}
        keyExtractor={(event) => event.id}
        testIdPrefix="event-row"
        testId="events-table"
      />

      {showPrevious && (
        <>
          <Divider labelPosition="center" label="Previous Events" />
          <ResponsiveTable
            data={sortedPreviousEvents}
            columns={columns}
            keyExtractor={(event) => event.id}
            testIdPrefix="event-previous-row"
            testId="previous-events-table"
          />
        </>
      )}
    </AuthGuard>
  );
};