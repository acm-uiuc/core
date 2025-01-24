import { Text, Button, Table, Modal, Group, Transition, ButtonGroup } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconTrash } from '@tabler/icons-react';
// import dayjs from 'dayjs';
import React, { useEffect, useState } from 'react';
// import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

// import { capitalizeFirstLetter } from './ManageEvent.page.js';
import FullScreenLoader from '@ui/components/AuthContext/LoadingScreen';
import { AuthGuard } from '@ui/components/AuthGuard';
import { useApi } from '@ui/util/api';
import { AppRoles } from '@common/roles.js';

// const repeatOptions = ['weekly', 'biweekly'] as const;

const userSchema = z.object({
  netid: z.string().min(1),
  firstName: z.string().min(1),
  middleName: z.string().optional(),
  lastName: z.string().min(1),
  sig: z.string(),
  // location: z.string(),
  // locationLink: z.optional(z.string().url()),
  // host: z.string(),
  // featured: z.boolean().default(false),
  // paidEventId: z.optional(z.string().min(1)),
});

const usersSchema = z.array(userSchema);

// const requestSchema = baseSchema.extend({
//   repeats: z.optional(z.enum(repeatOptions)),
//   repeatEnds: z.string().optional(),
// });

// const getEventSchema = requestSchema.extend({
//   id: z.string(),
//   upcoming: z.boolean().optional(),
// });

export type User = z.infer<typeof userSchema>;
export type Users = z.infer<typeof usersSchema>;

// export type EventGetResponse = z.infer<typeof getEventSchema>;
// const getEventsSchema = z.array(getEventSchema);
// export type EventsGetResponse = z.infer<typeof getEventsSchema>;

export const ScreenPage: React.FC = () => {
  const [userList, setUserList] = useState<Users>([]);
  const api = useApi('core');
  const [opened, { open, close }] = useDisclosure(false);
  // const [showPrevious, { toggle: togglePrevious }] = useDisclosure(false); // Changed default to false
  const [userRemoved, setRemoveUser] = useState<User | null>(null);
  // const navigate = useNavigate();

  const renderTableRow = (user: User) => {
    // const shouldShow = event.upcoming || (!event.upcoming && showPrevious);

    return (
      // <Transition mounted={shouldShow} transition="fade" duration={400} timingFunction="ease">
      <Transition mounted={true} transition="fade" duration={400} timingFunction="ease">
        {(styles) => (
          // <tr style={{ ...styles, display: shouldShow ? 'table-row' : 'none' }}>
          <tr style={{ ...styles, display: 'table-row' }}>
            <Table.Td>{user.netid}</Table.Td>
            <Table.Td>{user.firstName}</Table.Td>
            <Table.Td>{user.middleName}</Table.Td>
            <Table.Td>{user.lastName}</Table.Td>
            <Table.Td>{user.sig}</Table.Td>
            {/* <Table.Td>{dayjs(event.start).format('MMM D YYYY hh:mm')}</Table.Td>
            <Table.Td>{event.end ? dayjs(event.end).format('MMM D YYYY hh:mm') : 'N/A'}</Table.Td>
            <Table.Td>{event.location}</Table.Td>
            <Table.Td>{event.description}</Table.Td>
            <Table.Td>{event.host}</Table.Td>
            <Table.Td>{event.featured ? 'Yes' : 'No'}</Table.Td> */}
            {/* <Table.Td>{capitalizeFirstLetter(event.repeats || 'Never')}</Table.Td> */}
            {/* <Table.Td>
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
            </Table.Td> */}
          </tr>
        )}
      </Transition>
    );
  };

  useEffect(() => {
    const getUsers = async () => {
      // const response = await api.get('/api/v1/events');
      // const upcomingEvents = await api.get('/api/v1/events?upcomingOnly=true');
      // const upcomingEventsSet = new Set(upcomingEvents.data.map((x: EventGetResponse) => x.id));
      // const events = response.data;
      // events.sort((a: User, b: User) => {
      //   return a.start.localeCompare(b.start);
      // });
      // const enrichedResponse = response.data.map((item: EventGetResponse) => {
      //   if (upcomingEventsSet.has(item.id)) {
      //     return { ...item, upcoming: true };
      //   }
      //   return { ...item, upcoming: false };
      // });

      // prettier-ignore
      const mockUserResponse: Users = [
        { netid: "ethanc12", firstName: "Ethan", middleName:"Yuting", lastName: "Chang", sig: "Infra"},
        { netid: "johnd01", firstName: "John", lastName: "Doe", sig: "SIGMusic" },
        { netid: "sarahg23", firstName: "Sarah", middleName: "Grace", lastName: "Gonzalez", sig: "SIGQuantum" },
        { netid: "miker44", firstName: "Michael", lastName: "Roberts", sig: "SIGPlan" },
        { netid: "annaw02", firstName: "Anna", middleName: "Marie", lastName: "Williams", sig: "SIGMobile" },
        { netid: "chrisb19", firstName: "Christopher", lastName: "Brown", sig: "SIGCHI" },
        { netid: "laurenp87", firstName: "Lauren", middleName: "Patricia", lastName: "Perez", sig: "SIGPwny" },
        { netid: "ethanw12", firstName: "Ethan", lastName: "Wong", sig: "SIGEcom" },
        { netid: "emilyh54", firstName: "Emily", lastName: "Hernandez", sig: "SIGRobotics" },
        { netid: "kevink11", firstName: "Kevin", middleName: "Lee", lastName: "Kim", sig: "Infra" },
        { netid: "juliel08", firstName: "Julie", lastName: "Lopez", sig: "SIGGRAPH" },
        { netid: "mattt92", firstName: "Matthew", middleName: "Thomas", lastName: "Taylor", sig: "SIGtricity" },
        { netid: "rachelb03", firstName: "Rachel", lastName: "Bell", sig: "SIGSYS" },
        { netid: "stephenj45", firstName: "Stephen", middleName: "James", lastName: "Johnson", sig: "SIGAIDA" },
        { netid: "ashleyc28", firstName: "Ashley", lastName: "Clark", sig: "SIGNLL" },
        { netid: "briand77", firstName: "Brian", lastName: "Davis", sig: "SIGMA" },
        { netid: "meganf65", firstName: "Megan", lastName: "Flores", sig: "SIGPolicy" },
        { netid: "danielh04", firstName: "Daniel", lastName: "Hughes", sig: "SIGARCH" },
        { netid: "victorc16", firstName: "Victor", middleName: "Charles", lastName: "Carter", sig: "SIGGLUG" },
        { netid: "lindam29", firstName: "Linda", lastName: "Martinez", sig: "SIGMobile" },
        { netid: "paulf31", firstName: "Paul", lastName: "Fisher", sig: "SIGMusic" },
        { netid: "susana80", firstName: "Susan", middleName: "Ann", lastName: "Anderson", sig: "SIGPwny" },
        { netid: "markl13", firstName: "Mark", lastName: "Lewis", sig: "SIGCHI" },
        { netid: "carolynb59", firstName: "Carolyn", lastName: "Barnes", sig: "SIGSYS" },
        { netid: "patrickh37", firstName: "Patrick", middleName: "Henry", lastName: "Hill", sig: "SIGQuantum" },
        { netid: "nataliep71", firstName: "Natalie", lastName: "Price", sig: "SIGPolicy" },
      ];
      setUserList(mockUserResponse);
    };
    getUsers();
  }, []);

  const removeUser = async (netid: string) => {
    try {
      // await api.delete(`/api/v1/events/${eventId}`);
      setUserList((prevUsers) => prevUsers.filter((u) => u.netid !== netid));
      notifications.show({
        title: 'User removed',
        message: 'The user was successfully removed.',
      });
      close();
    } catch (error) {
      console.error(error);
      notifications.show({
        title: 'Error removing user',
        message: `${error}`,
        color: 'red',
      });
    }
  };

  if (userList.length === 0) {
    return <FullScreenLoader />;
  }

  return (
    // <AuthGuard resourceDef={{ service: 'core', validRoles: [AppRoles.USERS_ADMIN] }}>
    <AuthGuard resourceDef={{ service: 'core', validRoles: [AppRoles.IAM_ADMIN] }}>
      {userRemoved && (
        <Modal
          opened={opened}
          onClose={() => {
            setRemoveUser(null);
            close();
          }}
          title="Confirm action"
        >
          <Text>
            Are you sure you want to remove the user <i>{userRemoved?.netid}</i>?
          </Text>
          <hr />
          <Group>
            <Button
              leftSection={<IconTrash />}
              onClick={() => {
                removeUser(userRemoved?.netid);
              }}
            >
              Delete
            </Button>
          </Group>
        </Modal>
      )}
      {/* <div style={{ display: 'flex', columnGap: '1vw', verticalAlign: 'middle' }}>
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
      </div> */}
      <Table style={{ tableLayout: 'fixed', width: '100%' }} data-testid="users-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>NetID</Table.Th>
            <Table.Th>First Name</Table.Th>
            <Table.Th>Middle Name</Table.Th>
            <Table.Th>Last Name</Table.Th>
            <Table.Th>Affiliated Special Interest Group</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>{userList.map(renderTableRow)}</Table.Tbody>
      </Table>
    </AuthGuard>
  );
};
