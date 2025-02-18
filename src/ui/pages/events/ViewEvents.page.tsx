import { Text, Button, Table, Modal, Group, Transition, ButtonGroup, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import dayjs from 'dayjs';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { capitalizeFirstLetter } from './ManageEvent.page.js';
import FullScreenLoader from '@ui/components/AuthContext/LoadingScreen';
import { AuthGuard } from '@ui/components/AuthGuard';
import { useApi } from '@ui/util/api';
import { AppRoles } from '@common/roles.js';

const repeatOptions = ['weekly', 'biweekly'] as const;

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
  const api = useApi('core');
  const [opened, { open, close }] = useDisclosure(false);
  const [showPrevious, { toggle: togglePrevious }] = useDisclosure(false); // Changed default to false
  const [deleteCandidate, setDeleteCandidate] = useState<EventGetResponse | null>(null);
  const navigate = useNavigate();

  const renderTableRow = (event: EventGetResponse) => {
    const shouldShow = event.upcoming || (!event.upcoming && showPrevious);

    return (
      <Transition
        mounted={shouldShow}
        transition="fade"
        duration={400}
        timingFunction="ease"
        key={`${event.id}-tr-transition`}
      >
        {(styles) => (
          <tr
            style={{ ...styles, display: shouldShow ? 'table-row' : 'none' }}
            key={`${event.id}-tr`}
          >
            <Table.Td>{event.title}</Table.Td>
            <Table.Td>{dayjs(event.start).format('MMM D YYYY hh:mm')}</Table.Td>
            <Table.Td>{event.end ? dayjs(event.end).format('MMM D YYYY hh:mm') : 'N/A'}</Table.Td>
            <Table.Td>{event.location}</Table.Td>
            <Table.Td>{event.description}</Table.Td>
            <Table.Td>{event.host}</Table.Td>
            <Table.Td>{event.featured ? 'Yes' : 'No'}</Table.Td>
            <Table.Td>{capitalizeFirstLetter(event.repeats || 'Never')}</Table.Td>
            <Table.Td>
              <ButtonGroup>
                <Button component="a" href={`/events/edit/${event.id}`}>
                  Edit
                </Button>
                <Button
                  color="red"
                  onClick={() => {
                    setDeleteCandidate(event);
                    open();
                  }}
                >
                  Delete
                </Button>
              </ButtonGroup>
            </Table.Td>
          </tr>
        )}
      </Transition>
    );
  };

  useEffect(() => {
    const getEvents = async () => {
      const response = await api.get('/api/v1/events', {
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache', Expires: 0 },
      });
      const upcomingEvents = await api.get('/api/v1/events?upcomingOnly=true', {
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache', Expires: 0 },
      });
      const upcomingEventsSet = new Set(upcomingEvents.data.map((x: EventGetResponse) => x.id));
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
    };
    getEvents();
  }, []);

  const deleteEvent = async (eventId: string) => {
    try {
      await api.delete(`/api/v1/events/${eventId}`);
      setEventList((prevEvents) => prevEvents.filter((event) => event.id !== eventId));
      notifications.show({
        title: 'Event deleted',
        message: 'The event was successfully deleted.',
      });
      close();
    } catch (error) {
      console.error(error);
      notifications.show({
        title: 'Error deleting event',
        message: `${error}`,
        color: 'red',
      });
    }
  };

  if (eventList.length === 0) {
    return <FullScreenLoader />;
  }

  return (
    <AuthGuard resourceDef={{ service: 'core', validRoles: [AppRoles.EVENTS_MANAGER] }}>
      <Title order={1} mb={'md'}>
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
            Are you sure you want to delete the event <i>{deleteCandidate?.title}</i>?
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
      <div style={{ display: 'flex', columnGap: '1vw', verticalAlign: 'middle' }}>
        <Button
          leftSection={<IconPlus size={14} />}
          onClick={() => {
            navigate('/events/add');
          }}
        >
          New Calendar Event
        </Button>
        <Button onClick={togglePrevious}>
          {showPrevious ? 'Hide Previous Events' : 'Show Previous Events'}
        </Button>
      </div>
      <Table style={{ tableLayout: 'fixed', width: '100%' }} data-testid="events-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Title</Table.Th>
            <Table.Th>Start</Table.Th>
            <Table.Th>End</Table.Th>
            <Table.Th>Location</Table.Th>
            <Table.Th>Description</Table.Th>
            <Table.Th>Host</Table.Th>
            <Table.Th>Featured</Table.Th>
            <Table.Th>Repeats</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>{eventList.map(renderTableRow)}</Table.Tbody>
      </Table>
    </AuthGuard>
  );
};
