import {
  Text,
  Title,
  Button,
  Table,
  Modal,
  Group,
  Transition,
  ButtonGroup,
  Anchor,
  Badge,
  Tabs,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconCancel, IconCross, IconEdit, IconPlus, IconTrash } from '@tabler/icons-react';
import dayjs from 'dayjs';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { capitalizeFirstLetter } from './ManageLink.page.js';
import FullScreenLoader from '@ui/components/AuthContext/LoadingScreen';
import { AuthGuard } from '@ui/components/AuthGuard';
import { useApi } from '@ui/util/api';
import { AppRoles } from '@common/roles.js';
import { wrap } from 'module';

const repeatOptions = ['weekly', 'biweekly'] as const;

const baseSchema = z.object({
  slug: z.string().min(1).optional(),
  access: z.string().min(1).optional(),
  redirect: z.string().min(1).optional(),
  createdAtUtc: z.number().optional(),
  updatedAtUtc: z.number().optional(),
  counter: z.number().optional(),
});

// const requestSchema = baseSchema.extend({
//   repeats: z.optional(z.enum(repeatOptions)),
//   repeatEnds: z.string().optional(),
// });

const getLinkrySchema = baseSchema.extend({
  id: z.string(),
});

const wrapTextStyle: React.CSSProperties = {
  wordWrap: 'break-word',
  overflowWrap: 'break-word' as const,
  whiteSpace: 'normal',
};

export type LinkryGetResponse = z.infer<typeof getLinkrySchema>;
//const getLinksSchema = z.array(getLinkrySchema);

export const LinkShortener: React.FC = () => {
  const [ownedLinks, setOwnedLinks] = useState<LinkryGetResponse[]>([]);
  const [delegatedLinks, setDelegatedLinks] = useState<LinkryGetResponse[]>([]);
  const api = useApi('core');
  const [opened, { open, close }] = useDisclosure(false);
  const [showPrevious, { toggle: togglePrevious }] = useDisclosure(false); // Changed default to false
  const [deleteLinkCandidate, setDeleteLinkCandidate] = useState<LinkryGetResponse | null>(null);
  const navigate = useNavigate();

  const renderTableRow = (link: LinkryGetResponse, index: number) => {
    const shouldShow = true;

    return (
      <Transition mounted={shouldShow} transition="fade" duration={10000} timingFunction="ease">
        {(styles) => (
          <tr
            style={{
              ...styles,
              display: shouldShow ? 'table-row' : 'none',
              backgroundColor: index % 2 === 0 ? '#f0f8ff' : '#ffffff',
            }}
          >
            <Table.Td style={wrapTextStyle}>
              <Anchor
                href={'http://localhost:8080/api/v1/linkry/redir/' + link.slug}
                target="_blank"
              >
                {' '}
                {/* Currently set to localhost for local testing purposes */}
                https://go.acm.illinois.edu/{link.slug}
              </Anchor>
            </Table.Td>
            <Table.Td style={wrapTextStyle}>
              <Anchor href={link.redirect} target="_blank">
                {link.redirect}
              </Anchor>
            </Table.Td>
            <Table.Td style={wrapTextStyle}>
              {link.access && link.access.length > 0 ? (
                link.access
                  .split(';') // Split the access string by ";"
                  .map((group, index) => (
                    <Badge
                      key={index}
                      color="#999898"
                      radius="sm"
                      style={{ marginRight: '2px', marginBottom: '2px' }}
                    >
                      {group.trim()} {/* Trim any extra whitespace */}
                    </Badge>
                  ))
              ) : (
                <></>
              )}
            </Table.Td>
            <Table.Td style={wrapTextStyle}>{link.counter || 0}</Table.Td>
            {/* <Table.Td style={wrapTextStyle}>{dayjs(link.createdAtUtc).format('MMM D YYYY hh:mm')}</Table.Td>
            <Table.Td style={wrapTextStyle}>{dayjs(link.updatedAtUtc).format('MMM D YYYY hh:mm')}</Table.Td> */}
            <Table.Td
              style={{
                textAlign: 'center',
                justifyContent: 'rightcenter',
                alignItems: 'center',
              }}
            >
              <ButtonGroup>
                {/* <Button component="a" href={`/linkry/edit/${link.id}`}>
                  Edit
                </Button> */}
                <Button
                  component="a"
                  href={link.slug ? `/link/edit/${encodeURIComponent(link.slug)}` : '#'}
                >
                  <IconEdit size={16} />
                </Button>
                <Button
                  color="red"
                  onClick={() => {
                    setDeleteLinkCandidate(link);
                    open();
                  }}
                >
                  <IconTrash size={16} />
                </Button>
              </ButtonGroup>
            </Table.Td>
          </tr>
        )}
      </Transition>
    );
  };

  const renderDelegatedLinks = (link: LinkryGetResponse, index: number) => {
    const shouldShow = true;

    return (
      <Transition mounted={shouldShow} transition="fade" duration={400} timingFunction="ease">
        {(styles) => (
          <tr
            style={{
              ...styles,
              display: shouldShow ? 'table-row' : 'none',
              backgroundColor: index % 2 === 0 ? '#f0f8ff' : '#ffffff',
            }}
          >
            <Table.Td style={wrapTextStyle}>
              <Anchor
                href={'http://localhost:8080/api/v1/linkry/redir/' + link.slug}
                target="_blank"
              >
                {' '}
                {/* Currently set to localhost for local testing purposes */}
                https://go.acm.illinois.edu/{link.slug}
              </Anchor>
            </Table.Td>
            <Table.Td style={wrapTextStyle}>
              <Anchor
                href={'http://localhost:8080/api/v1/linkry/redir/' + link.slug}
                target="_blank"
              >
                {link.redirect}
              </Anchor>
            </Table.Td>
            <Table.Td style={wrapTextStyle}>
              {link.access
                ?.split(';') // Split the access string by ";"
                .map((group, index) => (
                  <Badge
                    key={index}
                    color="#999898"
                    radius="sm"
                    style={{ marginRight: '2px', marginBottom: '2px' }}
                  >
                    {group.trim()} {/* Trim any extra whitespace */}
                  </Badge>
                ))}
            </Table.Td>
            {/* <Table.Td style={wrapTextStyle}>{dayjs(link.createdAtUtc).format('MMM D YYYY hh:mm')}</Table.Td>
            <Table.Td style={wrapTextStyle}>{dayjs(link.updatedAtUtc).format('MMM D YYYY hh:mm')}</Table.Td> */}
            <Table.Td
              style={{
                textAlign: 'center',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <ButtonGroup>
                {/* <Button component="a" href={`/linkry/edit/${link.id}`}>
                  Edit
                </Button> */}
                <Button
                  component="a"
                  href={link.slug ? `/link/edit/${encodeURIComponent(link.slug)}` : '#'}
                >
                  <IconEdit size={16} />
                </Button>
                <Button
                  color="red"
                  onClick={() => {
                    setDeleteLinkCandidate(link);
                    open();
                  }}
                >
                  <IconTrash size={16} />
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
      const ownedLinks = response.data.ownedLinks;
      const delegatedLinks = response.data.delegatedLinks;
      // events.sort((a: EventGetResponse, b: EventGetResponse) => {
      //   return a.start.localeCompare(b.start);
      // });
      // const enrichedResponse = response.data.map((item: EventGetResponse) => {
      //   if (upcomingEventsSet.has(item.id)) {
      //     return { ...item, upcoming: true };
      //   }
      //   return { ...item, upcoming: false };
      // });
      setOwnedLinks(ownedLinks);
      setDelegatedLinks(delegatedLinks);
    };
    getEvents();
  }, []);

  const deleteLink = async (slug: string) => {
    try {
      const encodedSlug = encodeURIComponent(slug);
      await api.delete(`/api/v1/linkry/redir/${encodedSlug}`);
      setOwnedLinks((prevEvents) => prevEvents.filter((link) => link.slug !== slug));
      notifications.show({
        title: 'Link deleted',
        message: 'The link was deleted successfully.',
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

  /*if (ownedLinks.length === 0) {
    return <FullScreenLoader />;
  }*/ //Don't know what is this purpose, disable for now...

  return (
    <AuthGuard resourceDef={{ service: 'core', validRoles: [AppRoles.EVENTS_MANAGER] }}>
      {deleteLinkCandidate && (
        <Modal
          opened={opened}
          onClose={() => {
            setDeleteLinkCandidate(null);
            close();
          }}
          title="Confirm action"
        >
          <Text>
            Are you sure you want to delete the link with slug <i>{deleteLinkCandidate?.slug}</i>?
          </Text>
          <hr />
          <Group>
            <Button
              leftSection={<IconTrash />}
              onClick={() => {
                if (deleteLinkCandidate?.slug) {
                  deleteLink(deleteLinkCandidate.slug);
                }
              }}
            >
              Delete
            </Button>
            <Button
              color="Red"
              leftSection={<IconCancel />}
              onClick={() => {
                setDeleteLinkCandidate(null); // Clear the delete candidate
                close(); // Close the modal
              }}
            >
              Cancel
            </Button>
          </Group>
        </Modal>
      )}
      <Title order={2} mb="md">
        Link Shortener
      </Title>

      <div
        style={{ display: 'flex', columnGap: '1vw', verticalAlign: 'middle', marginBottom: '20px' }}
      >
        <Button
          leftSection={<IconPlus size={14} />}
          onClick={() => {
            navigate('/link/add');
          }}
        >
          Add New Link
        </Button>
      </div>

      <Tabs
        defaultValue="owned"
        styles={{
          tab: {
            fontWeight: 'bold',
            color: 'rgb(34, 139, 230)',
          },
        }}
      >
        <Tabs.List>
          <Tabs.Tab value="owned">Owned Links</Tabs.Tab>
          <Tabs.Tab value="delegated">Delegated Links</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="owned" pt="xs">
          <div style={{ width: '100%', overflowX: 'auto' }}>
            <Table style={{ tableLayout: 'fixed', width: '100%' }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Shortened Link</Table.Th>
                  <Table.Th>Redirect URL</Table.Th>
                  <Table.Th>Access Groups</Table.Th>
                  <Table.Th>Visit Count</Table.Th>
                  {/* <Table.Th>Created At</Table.Th>
                  <Table.Th>Updated At</Table.Th> */}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>{ownedLinks.map(renderTableRow)}</Table.Tbody>
            </Table>
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="delegated" pt="xs">
          <div style={{ width: '100%', overflowX: 'auto' }}>
            <Table style={{ tableLayout: 'fixed', width: '100%' }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Shortened Link</Table.Th>
                  <Table.Th>Redirect URL</Table.Th>
                  <Table.Th>Access Groups</Table.Th>
                  <Table.Th>Visit Count</Table.Th>
                  {/* <Table.Th>Created At</Table.Th>
                  <Table.Th>Updated At</Table.Th> */}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>{delegatedLinks.map(renderTableRow)}</Table.Tbody>
            </Table>
          </div>
        </Tabs.Panel>
      </Tabs>
    </AuthGuard>
  );
};
