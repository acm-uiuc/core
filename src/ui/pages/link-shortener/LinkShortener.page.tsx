import { Text, Title, Button, Table, Modal, Group, Transition, ButtonGroup } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import dayjs from 'dayjs';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { capitalizeFirstLetter } from './ManageLink.page.js';
import FullScreenLoader from '@ui/components/AuthContext/LoadingScreen';
import { AuthGuard } from '@ui/components/AuthGuard';
import { useApi } from '@ui/util/api';
import { AppRoles } from '@common/roles.js';

const repeatOptions = ['weekly', 'biweekly'] as const;

const baseSchema = z.object({
  slug: z.string().min(1).optional(),
  access: z.string().min(1).optional(),
  redirect: z.string().min(1).optional(),
  createdAtUtc: z.number().optional(),
  updatedAtUtc: z.number().optional(),
});

// const requestSchema = baseSchema.extend({
//   repeats: z.optional(z.enum(repeatOptions)),
//   repeatEnds: z.string().optional(),
// });

const getLinkrySchema = baseSchema.extend({
  id: z.string(),
});

const wrapTextStyle = {
  wordWrap: 'break-word',
  overflowWrap: 'break-word',
  whiteSpace: 'normal',
};

export type LinkryGetResponse = z.infer<typeof getLinkrySchema>;
//const getLinksSchema = z.array(getLinkrySchema);

export const LinkShortener: React.FC = () => {
  const [linkList, setLinkList] = useState<LinkryGetResponse[]>([]);
  const api = useApi('core');
  const [opened, { open, close }] = useDisclosure(false);
  const [showPrevious, { toggle: togglePrevious }] = useDisclosure(false); // Changed default to false
  const [deleteCandidate, setDeleteCandidate] = useState<LinkryGetResponse | null>(null);
  const navigate = useNavigate();

  const renderTableRow = (link: LinkryGetResponse) => {
    const shouldShow = true;

    return (
      <Transition mounted={shouldShow} transition="fade" duration={400} timingFunction="ease">
        {(styles) => (
          <tr style={{ ...styles, display: shouldShow ? 'table-row' : 'none' }}>
            <Table.Td style={wrapTextStyle}>{link.slug}</Table.Td>
            <Table.Td style={wrapTextStyle}>{link.redirect}</Table.Td>
            <Table.Td style={wrapTextStyle}>{link.access}</Table.Td>
            {/* <Table.Td style={wrapTextStyle}>{dayjs(link.createdAtUtc).format('MMM D YYYY hh:mm')}</Table.Td>
            <Table.Td style={wrapTextStyle}>{dayjs(link.updatedAtUtc).format('MMM D YYYY hh:mm')}</Table.Td> */}
            <Table.Td>
              <ButtonGroup>
                {/* <Button component="a" href={`/linkry/edit/${link.id}`}>
                  Edit
                </Button> */}
                <Button
                  color="red"
                  onClick={() => {
                    //setDeleteCandidate(event);
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
      const response = await api.get('/api/v1/linkry/redir');
      //const upcomingEvents = await api.get('/api/v1/events?upcomingOnly=true');
      //const upcomingEventsSet = new Set(upcomingEvents.data.map((x: EventGetResponse) => x.id));
      const events = response.data;
      // events.sort((a: EventGetResponse, b: EventGetResponse) => {
      //   return a.start.localeCompare(b.start);
      // });
      // const enrichedResponse = response.data.map((item: EventGetResponse) => {
      //   if (upcomingEventsSet.has(item.id)) {
      //     return { ...item, upcoming: true };
      //   }
      //   return { ...item, upcoming: false };
      // });
      setLinkList(events);
    };
    getEvents();
  }, []);

  const deleteEvent = async (eventId: string) => {
    // try {
    //   await api.delete(`/api/v1/events/${eventId}`);
    //   setEventList((prevEvents) => prevEvents.filter((event) => event.id !== eventId));
    //   notifications.show({
    //     title: 'Event deleted',
    //     message: 'The event was successfully deleted.',
    //   });
    //   close();
    // } catch (error) {
    //   console.error(error);
    //   notifications.show({
    //     title: 'Error deleting event',
    //     message: `${error}`,
    //     color: 'red',
    //   });
    // }
  };

  if (linkList.length === 0) {
    return <FullScreenLoader />;
  }

  return (
    <AuthGuard resourceDef={{ service: 'core', validRoles: [AppRoles.EVENTS_MANAGER] }}>
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
      <Title order={2} mb="md">
        Link Shortener
      </Title>
      <div style={{ display: 'flex', columnGap: '1vw', verticalAlign: 'middle' }}>
        <Button
          leftSection={<IconPlus size={14} />}
          onClick={() => {
            navigate('/link/add');
          }}
        >
          Add New Link
        </Button>
        {/* <Button onClick={togglePrevious}>
          {showPrevious ? 'Hide Previous Events' : 'Show Previous Events'}
        </Button> */}
      </div>
      <Table style={{ tableLayout: 'fixed', width: '100%' }}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Slug</Table.Th>
            <Table.Th>Redirect URL</Table.Th>
            <Table.Th>Access Group</Table.Th>
            {/* <Table.Th>Created At</Table.Th>
            <Table.Th>Updated At</Table.Th> */}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>{linkList.map(renderTableRow)}</Table.Tbody>
      </Table>
    </AuthGuard>
  );
};
