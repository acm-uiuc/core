// import { useDisclosure } from "@mantine/hooks";
import { useEffect, useMemo, useState } from 'react';
import { MantineReactTable, type MRT_ColumnDef } from 'mantine-react-table';
import { z } from 'zod';
import { OrganizationList } from '@common/orgs';

const OrganizationListEnum = z.enum(OrganizationList);

const userSchema = z.object({
  netid: z.string().min(1),
  org: OrganizationListEnum,
  firstName: z.string().min(1),
  middleName: z.string().optional(),
  lastName: z.string().min(1),
});

const orgSuperRowSchema = userSchema.extend({
  netid: z.string().max(0),
  firstName: z.string().max(0),
  lastName: z.string().max(0),
  subRows: userSchema.omit({ org: true }).array(), // redundant so omit org
});

export type Org = z.infer<typeof OrganizationListEnum>;
export type User = z.infer<typeof userSchema>;
export type OrgSuperRow = z.infer<typeof orgSuperRowSchema>;

function groupUsersByOrg(users: User[]): OrgSuperRow[] {
  const grouped: Record<Org, User[]> = {} as Record<Org, User[]>;

  // Group users by organization
  users.forEach((user) => {
    if (!grouped[user.org]) {
      grouped[user.org] = [];
    }
    grouped[user.org].push(user);
  });

  // Transform into the desired structure
  const reformatted = Object.entries(grouped).map(([org, subRows]) =>
    orgSuperRowSchema.parse({
      netid: '',
      org,
      firstName: '',
      lastName: '',
      subRows,
    })
  );

  return reformatted;
}

export const ScreenComponent: React.FC = () => {
  const [userList, setUserList] = useState<OrgSuperRow[]>([]);
  const columns = useMemo<MRT_ColumnDef<OrgSuperRow>[]>(
    () => [
      {
        accessorKey: 'org',
        header: 'Organization',
      },
      {
        accessorKey: 'netid',
        header: 'NetID',
      },
      {
        accessorKey: 'firstName',
        header: 'First Name',
      },
      {
        accessorKey: 'lastName',
        header: 'Last Name',
      },
    ],
    []
  );
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

      // mock data
      const userOrgsResponse = [
        { netid: 'johnd01', org: 'SIGMusic' },
        { netid: 'miker44', org: 'SIGPLAN' },
        { netid: 'chrisb19', org: 'SIGCHI' },
        { netid: 'ethanw12', org: 'SIGecom' },
        { netid: 'emilyh54', org: 'SIGRobotics' },
        { netid: 'juliel08', org: 'SIGGRAPH' },
        { netid: 'rachelb03', org: 'GameBuilders' },
        { netid: 'ashleyc28', org: 'SIGNLL' },
        { netid: 'briand77', org: 'SIGma' },
        { netid: 'meganf65', org: 'SIGPolicy' },
        { netid: 'danielh04', org: 'SIGARCH' },
        { netid: 'lindam29', org: 'SIGMobile' },
        { netid: 'paulf31', org: 'SIGMusic' },
        { netid: 'markl13', org: 'SIGCHI' },
        { netid: 'carolynb59', org: 'ACM' },
        { netid: 'nataliep71', org: 'SIGPolicy' },

        { netid: 'ethanc12', org: 'Infrastructure Committee' },
        { netid: 'sarahg23', org: 'SIGQuantum' },
        { netid: 'annaw02', org: 'SIGMobile' },
        { netid: 'laurenp87', org: 'SIGPwny' },
        { netid: 'kevink11', org: 'Infrastructure Committee' },
        { netid: 'mattt92', org: 'SIGtricity' },
        { netid: 'stephenj45', org: 'SIGAIDA' },
        { netid: 'victorc16', org: 'GLUG' },
        { netid: 'susana80', org: 'SIGPwny' },
        { netid: 'patrickh37', org: 'SIGQuantum' },
      ];

      // retrieve from azure active directory (aad)
      const userNamesResponse = [
        { netid: 'johnd01', firstName: 'John', lastName: 'Doe' },
        { netid: 'miker44', firstName: 'Michael', lastName: 'Roberts' },
        { netid: 'chrisb19', firstName: 'Christopher', lastName: 'Brown' },
        { netid: 'ethanw12', firstName: 'Ethan', lastName: 'Wong' },
        { netid: 'emilyh54', firstName: 'Emily', lastName: 'Hernandez' },
        { netid: 'juliel08', firstName: 'Julie', lastName: 'Lopez' },
        { netid: 'rachelb03', firstName: 'Rachel', lastName: 'Bell' },
        { netid: 'ashleyc28', firstName: 'Ashley', lastName: 'Clark' },
        { netid: 'briand77', firstName: 'Brian', lastName: 'Davis' },
        { netid: 'meganf65', firstName: 'Megan', lastName: 'Flores' },
        { netid: 'danielh04', firstName: 'Daniel', lastName: 'Hughes' },
        { netid: 'lindam29', firstName: 'Linda', lastName: 'Martinez' },
        { netid: 'paulf31', firstName: 'Paul', lastName: 'Fisher' },
        { netid: 'markl13', firstName: 'Mark', lastName: 'Lewis' },
        { netid: 'carolynb59', firstName: 'Carolyn', lastName: 'Barnes' },
        { netid: 'nataliep71', firstName: 'Natalie', lastName: 'Price' },

        { netid: 'ethanc12', firstName: 'Ethan', middleName: 'Yuting', lastName: 'Chang' },
        { netid: 'sarahg23', firstName: 'Sarah', middleName: 'Grace', lastName: 'Gonzalez' },
        { netid: 'annaw02', firstName: 'Anna', middleName: 'Marie', lastName: 'Williams' },
        { netid: 'laurenp87', firstName: 'Lauren', middleName: 'Patricia', lastName: 'Perez' },
        { netid: 'kevink11', firstName: 'Kevin', middleName: 'Lee', lastName: 'Kim' },
        { netid: 'mattt92', firstName: 'Matthew', middleName: 'Thomas', lastName: 'Taylor' },
        { netid: 'stephenj45', firstName: 'Stephen', middleName: 'James', lastName: 'Johnson' },
        { netid: 'victorc16', firstName: 'Victor', middleName: 'Charles', lastName: 'Carter' },
        { netid: 'susana80', firstName: 'Susan', middleName: 'Ann', lastName: 'Anderson' },
        { netid: 'patrickh37', firstName: 'Patrick', middleName: 'Henry', lastName: 'Hill' },
      ];

      const mergedResponse: User[] = userOrgsResponse.map((orgObj) => {
        const nameObj = userNamesResponse.find((name) => name.netid === orgObj.netid);
        return { ...orgObj, ...nameObj } as User;
      });

      // console.log(mergedResponse);
      setUserList(groupUsersByOrg(mergedResponse));
    };
    getUsers();
  }, []);

  // const removeUser = async (netid: string) => {
  //   try {
  //     // await api.delete(`/api/v1/events/${eventId}`);
  //     setUserList((prevUsers) => prevUsers.filter((u) => u.netid !== netid));
  //     notifications.show({
  //       title: 'User removed',
  //       message: 'The user was successfully removed.',
  //     });
  //     close();
  //   } catch (error) {
  //     console.error(error);
  //     notifications.show({
  //       title: 'Error removing user',
  //       message: `${error}`,
  //       color: 'red',
  //     });
  //   }
  // };

  // if (userList.length === 0) {
  //   return <FullScreenLoader />;
  // }

  // return (
  //   <AuthGuard resourceDef={{ service: 'core', validRoles: [AppRoles.IAM_ADMIN] }}>
  //     {userRemoved && (
  //       <Modal
  //         opened={opened}
  //         onClose={() => {
  //           setRemoveUser(null);
  //           close();
  //         }}
  //         title="Confirm action"
  //       >
  //         <Text>
  //           Are you sure you want to remove the user <i>{userRemoved?.netid}</i>?
  //         </Text>
  //         <hr />
  //         <Group>
  //           <Button
  //             leftSection={<IconTrash />}
  //             onClick={() => {
  //               removeUser(userRemoved?.netid);
  //             }}
  //           >
  //             Delete
  //           </Button>
  //         </Group>
  //       </Modal>
  //     )}
  //     {/* <div style={{ display: 'flex', columnGap: '1vw', verticalAlign: 'middle' }}>
  //       <Button
  //         leftSection={<IconPlus size={14} />}
  //         onClick={() => {
  //           navigate('/events/add');
  //         }}
  //       >
  //         New Calendar Event
  //       </Button>
  //       <Button onClick={togglePrevious}>
  //         {showPrevious ? 'Hide Previous Events' : 'Show Previous Events'}
  //       </Button>
  //     </div> */}
  //     <Table style={{ tableLayout: 'fixed', width: '100%' }} data-testid="users-table">
  //       <Table.Thead>
  //         <Table.Tr>
  //           <Table.Th>NetID</Table.Th>
  //           <Table.Th>First Name</Table.Th>
  //           <Table.Th>Middle Name</Table.Th>
  //           <Table.Th>Last Name</Table.Th>
  //           <Table.Th>Organization</Table.Th>
  //           <Table.Th>Actions</Table.Th>
  //         </Table.Tr>
  //       </Table.Thead>
  //       <Table.Tbody>{userList.map(renderTableRow)}</Table.Tbody>
  //     </Table>
  //   </AuthGuard>
  // );

  // const table = useMantineReactTable({
  //   columns,
  //   data,
  //   enableExpanding: true,
  //   getSubRows: (originalRow) => originalRow.subRows, //default, can customize
  // });

  return (
    <MantineReactTable
      columns={columns}
      data={userList}
      enableExpanding
      mantineTableBodyRowProps={({ row }) => ({
        // className: row.original.subRows ? 'super-row' : 'sub-row',
        style: row.original.subRows
          ? { fontWeight: 'bold' } // Super row styling
          : { fontWeight: 'lighter' }, // Sub-row styling
      })}
    />
  );
};
