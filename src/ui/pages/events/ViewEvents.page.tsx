import {
  Text,
  Button,
  Table,
  Modal,
  Group,
  Transition,
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
import * as z from "zod/v4";

import { capitalizeFirstLetter } from "./ManageEvent.page.js";
import FullScreenLoader from "@ui/components/AuthContext/LoadingScreen";
import { AuthGuard } from "@ui/components/AuthGuard";
import { useApi } from "@ui/util/api";
import { AppRoles } from "@common/roles.js";

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

  // Use useMemo to sort and filter events only when dependencies change
  const sortedUpcomingEvents = useMemo(() => {
    return eventList
      .filter((event: EventGetResponse) => event.upcoming)
      .sort(
        (a: EventGetResponse, b: EventGetResponse) =>
          new Date(a.start).getTime() - new Date(b.start).getTime(),
      );
  }, [eventList]);

  // Use useMemo to sort and filter previous events only when dependencies change
  const sortedPreviousEvents = useMemo(() => {
    return eventList
      .filter((event: EventGetResponse) => !event.upcoming)
      .sort((a: EventGetResponse, b: EventGetResponse) => {
        // For repeating events, compare by repeatEnds date first (if available)
        if (a.repeatEnds && b.repeatEnds) {
          return (
            new Date(b.repeatEnds).getTime() - new Date(a.repeatEnds).getTime()
          );
        } else if (a.repeatEnds) {
          return -1; // a has repeatEnds, b doesn't, so a comes first
        } else if (b.repeatEnds) {
          return 1; // b has repeatEnds, a doesn't, so b comes first
        }
        // Otherwise sort by start date in reverse order (newest first)
        return new Date(b.start).getTime() - new Date(a.start).getTime();
      });
  }, [eventList]);

  useEffect(() => {
    const getEvents = async () => {
      try {
        // Setting ts lets us tell cloudfront I want fresh data
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

  const renderEvent = (event: EventGetResponse) => {
    return (
      <tr key={`${event.id}-tr`}>
        <Table.Td>
          {event.title}{" "}
          {event.featured ? <Badge color="green">Featured</Badge> : null}
        </Table.Td>
        <Table.Td>{dayjs(event.start).format("MMM D YYYY hh:mm A")}</Table.Td>
        <Table.Td>
          {event.end ? dayjs(event.end).format("MMM D YYYY hh:mm A") : "N/A"}
        </Table.Td>
        <Table.Td>
          {event.locationLink ? (
            <Anchor target="_blank" size="sm" href={event.locationLink}>
              {event.location}
            </Anchor>
          ) : (
            event.location
          )}
        </Table.Td>
        <Table.Td>{event.host}</Table.Td>
        <Table.Td>{capitalizeFirstLetter(event.repeats || "Never")}</Table.Td>
        <Table.Td>
          <ButtonGroup>
            <Button component="a" href={`/events/edit/${event.id}`}>
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
        </Table.Td>
      </tr>
    );
  };

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
          New Calendar Event
        </Button>
        <Button onClick={togglePrevious}>
          {showPrevious ? "Hide Previous Events" : "Show Previous Events"}
        </Button>
      </div>

      <Table
        style={{ tableLayout: "fixed", width: "100%" }}
        data-testid="events-table"
      >
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Title</Table.Th>
            <Table.Th>Start</Table.Th>
            <Table.Th>End</Table.Th>
            <Table.Th>Location</Table.Th>
            <Table.Th>Host</Table.Th>
            <Table.Th>Repeats</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>{sortedUpcomingEvents.map(renderEvent)}</Table.Tbody>
      </Table>
      {showPrevious && (
        <>
          <Divider labelPosition="center" label="Previous Events" />
          <Table
            style={{ tableLayout: "fixed", width: "100%" }}
            data-testid="events-previous-table"
          >
            <Table.Tbody>
              {showPrevious && sortedPreviousEvents.map(renderEvent)}
            </Table.Tbody>
          </Table>
        </>
      )}
    </AuthGuard>
  );
};
