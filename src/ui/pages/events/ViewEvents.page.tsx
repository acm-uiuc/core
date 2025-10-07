import {
  Text,
  Button,
  Modal,
  Group,
  ButtonGroup,
  Title,
  Badge,
  Anchor,
  Divider,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import dayjs from "dayjs";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { capitalizeFirstLetter } from "./ManageEvent.page.js";
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
});

export type EventGetResponse = z.infer<typeof getEventSchema>;
const getEventsSchema = z.array(getEventSchema);
export type EventsGetResponse = z.infer<typeof getEventsSchema>;

export const ViewEventsPage: React.FC = () => {
  const [eventList, setEventList] = useState<EventsGetResponse>([]);
  const api = useApi("core");
  const [opened, { open, close }] = useDisclosure(false);
  const [showPrevious, { toggle: togglePrevious }] = useDisclosure(false);
  const [deleteCandidate, setDeleteCandidate] =
    useState<EventGetResponse | null>(null);
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

  const deleteEvent = async (eventId: string) => {
    try {
      await api.delete(`/api/v1/events/${eventId}`);
      setEventList((prevEvents) =>
        prevEvents.filter((event) => event.id !== eventId),
      );
      notifications.show({
        title: "Event deleted",
        message: "The event was successfully deleted.",
      });
      close();
    } catch (error) {
      console.error(error);
      notifications.show({
        title: "Error deleting event",
        message: `${error}`,
        color: "red",
      });
    }
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
        <ButtonGroup>
          <Button
            component="a"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/events/edit/${event.id}`);
            }}
          >
            Edit
          </Button>
          <Button
            color="red"
            onClick={(e) => {
              e.stopPropagation();
              setDeleteCandidate(event);
              open();
            }}
          >
            Delete
          </Button>
        </ButtonGroup>
      ),
    },
  ];

  if (eventList.length === 0) {
    return <FullScreenLoader />;
  }

  return (
    <AuthGuard
      resourceDef={{ service: "core", validRoles: [AppRoles.EVENTS_MANAGER] }}
    >
      <Title order={1} mb="md">
        Event Management
      </Title>

      {deleteCandidate && (
        <Modal
          opened={opened}
          onClose={() => {
            setDeleteCandidate(null);
            close();
          }}
          title="Confirm action"
        >
          <Text>
            Are you sure you want to delete the event{" "}
            <i>{deleteCandidate?.title}</i>?
          </Text>
          <hr />
          <Group>
            <Button
              leftSection={<IconTrash />}
              onClick={() => {
                deleteEvent(deleteCandidate?.id);
              }}
            >
              Delete
            </Button>
          </Group>
        </Modal>
      )}

      <div
        style={{ display: "flex", columnGap: "1vw", verticalAlign: "middle" }}
      >
        <Button
          leftSection={<IconPlus size={14} />}
          onClick={() => {
            navigate("/events/add");
          }}
        >
          Create Event
        </Button>
        <Button onClick={togglePrevious} variant="outline">
          {showPrevious ? "Hide Previous Events" : "Show Previous Events"}
        </Button>
      </div>

      <ResponsiveTable
        data={sortedUpcomingEvents}
        columns={columns}
        keyExtractor={(event) => event.id}
        testIdPrefix="event-row"
      />

      {showPrevious && (
        <>
          <Divider labelPosition="center" label="Previous Events" />
          <ResponsiveTable
            data={sortedPreviousEvents}
            columns={columns}
            keyExtractor={(event) => event.id}
            testIdPrefix="event-previous-row"
          />
        </>
      )}
    </AuthGuard>
  );
};
