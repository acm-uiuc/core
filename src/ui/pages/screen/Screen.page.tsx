// import { Text, Button, Table, Modal, Group, Transition, ButtonGroup } from '@mantine/core';
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
import { AppRoles } from '@common/roles.js';
import { OrganizationList } from '@common/orgs';
// import { User, UserName, UserOrg } from '@common/types/iam';
import { useApi } from '@ui/util/api';
import { UserProfileDataBase } from '@common/types/msGraphApi';
import { ScreenComponent } from './ScreenComponent';
import { Button, ButtonGroup, Group, Modal, Table, Transition } from '@mantine/core';

// const repeatOptions = ['weekly', 'biweekly'] as const;

// export type EventGetResponse = z.infer<typeof getEventSchema>;
// const getEventsSchema = z.array(getEventSchema);
// export type EventsGetResponse = z.infer<typeof getEventsSchema>;
const userSchema = z.object({
  netid: z.string().min(1),
  org: z.enum(OrganizationList),
  firstName: z.string().min(1),
  middleName: z.string().optional(),
  lastName: z.string().min(1),
});
export type User = z.infer<typeof userSchema>;

export const ScreenPage: React.FC = () => {
  // const graphApi = useApi('msGraphApi');
  // const [userList, setUserList] = useState<User[]>([]);
  // const [opened, { open, close }] = useDisclosure(false);
  // const [userRemoved, setRemoveUser] = useState<User | null>(null);

  // // const renderTableRow = (user: User) => {

  // const renderTableRow = (user: UserProfileDataBase) => {
  //   return (
  //     <Transition mounted={true} transition="fade" duration={400} timingFunction="ease">
  //       {(styles) => (
  //         <tr style={{ ...styles, display: 'table-row' }}>
  //           <Table.Td>{user.displayName}</Table.Td>
  //           <Table.Td>{user.givenName}</Table.Td>
  //           <Table.Td>{user.surname}</Table.Td>
  //           <Table.Td>{user.mail}</Table.Td>
  //           <Table.Td>{user.otherMails}</Table.Td>
  //           <Table.Td>{user.userPrincipalName}</Table.Td>
  //         </tr>
  //       )}
  //     </Transition>
  //   );
  // };

  // useEffect(() => {
  //   const getUsers = async () => {
  //     const raw = (await graphApi.get('/v1.0/me?$select=userPrincipalName,givenName,surname,displayName,org,mail')).data as UserProfileDataBase;
  //     // const raw = (await graphApi.get('/v1.0/me?$select=userPrincipalName,givenName,surname,displayName,organizations,mail')).data;
  //     // console.log(raw);
  //     // print(raw);
  //     setUserList([raw]);
  //     // const response = await api.get('/api/v1/events');
  //     // const upcomingEvents = await api.get('/api/v1/events?upcomingOnly=true');
  //     // const upcomingEventsSet = new Set(upcomingEvents.data.map((x: EventGetResponse) => x.id));
  //     // const events = response.data;
  //     // events.sort((a: User, b: User) => {
  //     //   return a.start.localeCompare(b.start);
  //     // });
  //     // const enrichedResponse = response.data.map((item: EventGetResponse) => {
  //     //   if (upcomingEventsSet.has(item.id)) {
  //     //     return { ...item, upcoming: true };
  //     //   }
  //     //   return { ...item, upcoming: false };
  //     // });

  //     // get request for user orgs
  //     // const userOrgsResponse: UserOrg[] = [
  //     // //   { netid: 'johnd01', org: 'SIGMusic' },
  //     // //   { netid: 'miker44', org: 'SIGPLAN' },
  //     // //   { netid: 'chrisb19', org: 'SIGCHI' },
  //     // //   { netid: 'ethanw12', org: 'SIGecom' },
  //     // //   { netid: 'emilyh54', org: 'SIGRobotics' },
  //     // //   { netid: 'juliel08', org: 'SIGGRAPH' },
  //     // //   { netid: 'rachelb03', org: 'GameBuilders' },
  //     // //   { netid: 'ashleyc28', org: 'SIGNLL' },
  //     // //   { netid: 'briand77', org: 'SIGma' },
  //     // //   { netid: 'meganf65', org: 'SIGPolicy' },
  //     // //   { netid: 'danielh04', org: 'SIGARCH' },
  //     // //   { netid: 'lindam29', org: 'SIGMobile' },
  //     // //   { netid: 'paulf31', org: 'SIGMusic' },
  //     // //   { netid: 'markl13', org: 'SIGCHI' },
  //     // //   { netid: 'carolynb59', org: 'ACM' },
  //     // //   { netid: 'nataliep71', org: 'SIGPolicy' },

  //     //   { netid: 'ethanc12', org: 'Infrastructure Committee' },
  //     // //   { netid: 'sarahg23', org: 'SIGQuantum' },
  //     // //   { netid: 'annaw02', org: 'SIGMobile' },
  //     // //   { netid: 'laurenp87', org: 'SIGPwny' },
  //     // //   { netid: 'kevink11', org: 'Infrastructure Committee' },
  //     // //   { netid: 'mattt92', org: 'SIGtricity' },
  //     // //   { netid: 'stephenj45', org: 'SIGAIDA' },
  //     // //   { netid: 'victorc16', org: 'GLUG' },
  //     // //   { netid: 'susana80', org: 'SIGPwny' },
  //     // //   { netid: 'patrickh37', org: 'SIGQuantum' },
  //     // ];

  //     // // // retrieve from azure active directory (aad)
  //     // const userNamesResponse: UserName[] = [
  //     // //   { netid: 'johnd01', firstName: 'John', lastName: 'Doe' },
  //     // //   { netid: 'miker44', firstName: 'Michael', lastName: 'Roberts' },
  //     // //   { netid: 'chrisb19', firstName: 'Christopher', lastName: 'Brown' },
  //     // //   { netid: 'ethanw12', firstName: 'Ethan', lastName: 'Wong' },
  //     // //   { netid: 'emilyh54', firstName: 'Emily', lastName: 'Hernandez' },
  //     // //   { netid: 'juliel08', firstName: 'Julie', lastName: 'Lopez' },
  //     // //   { netid: 'rachelb03', firstName: 'Rachel', lastName: 'Bell' },
  //     // //   { netid: 'ashleyc28', firstName: 'Ashley', lastName: 'Clark' },
  //     // //   { netid: 'briand77', firstName: 'Brian', lastName: 'Davis' },
  //     // //   { netid: 'meganf65', firstName: 'Megan', lastName: 'Flores' },
  //     // //   { netid: 'danielh04', firstName: 'Daniel', lastName: 'Hughes' },
  //     // //   { netid: 'lindam29', firstName: 'Linda', lastName: 'Martinez' },
  //     // //   { netid: 'paulf31', firstName: 'Paul', lastName: 'Fisher' },
  //     // //   { netid: 'markl13', firstName: 'Mark', lastName: 'Lewis' },
  //     // //   { netid: 'carolynb59', firstName: 'Carolyn', lastName: 'Barnes' },
  //     // //   { netid: 'nataliep71', firstName: 'Natalie', lastName: 'Price' },

  //     //   { netid: 'ethanc12', firstName: 'Ethan', middleName: 'Yuting', lastName: 'Chang' },
  //     // //   { netid: 'sarahg23', firstName: 'Sarah', middleName: 'Grace', lastName: 'Gonzalez' },
  //     // //   { netid: 'annaw02', firstName: 'Anna', middleName: 'Marie', lastName: 'Williams' },
  //     // //   { netid: 'laurenp87', firstName: 'Lauren', middleName: 'Patricia', lastName: 'Perez' },
  //     // //   { netid: 'kevink11', firstName: 'Kevin', middleName: 'Lee', lastName: 'Kim' },
  //     // //   { netid: 'mattt92', firstName: 'Matthew', middleName: 'Thomas', lastName: 'Taylor' },
  //     // //   { netid: 'stephenj45', firstName: 'Stephen', middleName: 'James', lastName: 'Johnson' },
  //     // //   { netid: 'victorc16', firstName: 'Victor', middleName: 'Charles', lastName: 'Carter' },
  //     // //   { netid: 'susana80', firstName: 'Susan', middleName: 'Ann', lastName: 'Anderson' },
  //     // //   { netid: 'patrickh37', firstName: 'Patrick', middleName: 'Henry', lastName: 'Hill' },
  //     // ];

  //     // const mergedResponse: User[] = userOrgsResponse.map((orgObj) => {
  //     //   const nameObj = userNamesResponse.find((name) => name.netid === orgObj.netid);
  //     //   return { ...orgObj, ...nameObj } as User;
  //     // });

  //     // setUserList(mergedResponse);
  //   };
  //   getUsers();
  // }, []);

  // return (
  //   <AuthGuard resourceDef={{ service: 'core', validRoles: [AppRoles.IAM_ADMIN] }}>
  //     {/* {userRemoved && (
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
  //     )} */}
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

  return <ScreenComponent />;
};

//   const [userList, setUserList] = useState<User[]>([]);
//   const [opened, { open, close }] = useDisclosure(false);
//   // const [showPrevious, { toggle: togglePrevious }] = useDisclosure(false); // Changed default to false
//   const [userRemoved, setRemoveUser] = useState<User | null>(null);
//   // const navigate = useNavigate();

//   const renderTableRow = (user: User) => {
//     // const shouldShow = event.upcoming || (!event.upcoming && showPrevious);

//     return (
//       // <Transition mounted={shouldShow} transition="fade" duration={400} timingFunction="ease">
//       <Transition mounted={true} transition="fade" duration={400} timingFunction="ease">
//         {(styles) => (
//           // <tr style={{ ...styles, display: shouldShow ? 'table-row' : 'none' }}>
//           <tr style={{ ...styles, display: 'table-row' }}>
//             <Table.Td>{user.netid}</Table.Td>
//             <Table.Td>{user.firstName}</Table.Td>
//             <Table.Td>{user.middleName}</Table.Td>
//             <Table.Td>{user.lastName}</Table.Td>
//             <Table.Td>{user.org}</Table.Td>
//             {/* <Table.Td>{dayjs(event.start).format('MMM D YYYY hh:mm')}</Table.Td>
//             <Table.Td>{event.end ? dayjs(event.end).format('MMM D YYYY hh:mm') : 'N/A'}</Table.Td>
//             <Table.Td>{event.location}</Table.Td>
//             <Table.Td>{event.description}</Table.Td>
//             <Table.Td>{event.host}</Table.Td>
//             <Table.Td>{event.featured ? 'Yes' : 'No'}</Table.Td> */}
//             {/* <Table.Td>{capitalizeFirstLetter(event.repeats || 'Never')}</Table.Td> */}
//             <Table.Td>
//               <ButtonGroup>
//                 {/* <Button component="a">Edit</Button> */}
//                 <Button
//                   color="red"
//                   onClick={() => {
//                     setRemoveUser(user);
//                     open();
//                   }}
//                 >
//                   Remove User
//                 </Button>
//               </ButtonGroup>
//             </Table.Td>
//           </tr>
//         )}
//       </Transition>
//     );
//   };

//   useEffect(() => {
//     const getUsers = async () => {
//       // const response = await api.get('/api/v1/events');
//       // const upcomingEvents = await api.get('/api/v1/events?upcomingOnly=true');
//       // const upcomingEventsSet = new Set(upcomingEvents.data.map((x: EventGetResponse) => x.id));
//       // const events = response.data;
//       // events.sort((a: User, b: User) => {
//       //   return a.start.localeCompare(b.start);
//       // });
//       // const enrichedResponse = response.data.map((item: EventGetResponse) => {
//       //   if (upcomingEventsSet.has(item.id)) {
//       //     return { ...item, upcoming: true };
//       //   }
//       //   return { ...item, upcoming: false };
//       // });

//       // get request for user orgs
//       const userOrgsResponse = [
//         { netid: 'johnd01', org: 'SIGMusic' },
//         { netid: 'miker44', org: 'SIGPLAN' },
//         { netid: 'chrisb19', org: 'SIGCHI' },
//         { netid: 'ethanw12', org: 'SIGecom' },
//         { netid: 'emilyh54', org: 'SIGRobotics' },
//         { netid: 'juliel08', org: 'SIGGRAPH' },
//         { netid: 'rachelb03', org: 'GameBuilders' },
//         { netid: 'ashleyc28', org: 'SIGNLL' },
//         { netid: 'briand77', org: 'SIGma' },
//         { netid: 'meganf65', org: 'SIGPolicy' },
//         { netid: 'danielh04', org: 'SIGARCH' },
//         { netid: 'lindam29', org: 'SIGMobile' },
//         { netid: 'paulf31', org: 'SIGMusic' },
//         { netid: 'markl13', org: 'SIGCHI' },
//         { netid: 'carolynb59', org: 'ACM' },
//         { netid: 'nataliep71', org: 'SIGPolicy' },

//         { netid: 'ethanc12', org: 'Infrastructure Committee' },
//         { netid: 'sarahg23', org: 'SIGQuantum' },
//         { netid: 'annaw02', org: 'SIGMobile' },
//         { netid: 'laurenp87', org: 'SIGPwny' },
//         { netid: 'kevink11', org: 'Infrastructure Committee' },
//         { netid: 'mattt92', org: 'SIGtricity' },
//         { netid: 'stephenj45', org: 'SIGAIDA' },
//         { netid: 'victorc16', org: 'GLUG' },
//         { netid: 'susana80', org: 'SIGPwny' },
//         { netid: 'patrickh37', org: 'SIGQuantum' },
//       ];

//       // retrieve from azure active directory (aad)
//       const userNamesResponse = [
//         { netid: 'johnd01', firstName: 'John', lastName: 'Doe' },
//         { netid: 'miker44', firstName: 'Michael', lastName: 'Roberts' },
//         { netid: 'chrisb19', firstName: 'Christopher', lastName: 'Brown' },
//         { netid: 'ethanw12', firstName: 'Ethan', lastName: 'Wong' },
//         { netid: 'emilyh54', firstName: 'Emily', lastName: 'Hernandez' },
//         { netid: 'juliel08', firstName: 'Julie', lastName: 'Lopez' },
//         { netid: 'rachelb03', firstName: 'Rachel', lastName: 'Bell' },
//         { netid: 'ashleyc28', firstName: 'Ashley', lastName: 'Clark' },
//         { netid: 'briand77', firstName: 'Brian', lastName: 'Davis' },
//         { netid: 'meganf65', firstName: 'Megan', lastName: 'Flores' },
//         { netid: 'danielh04', firstName: 'Daniel', lastName: 'Hughes' },
//         { netid: 'lindam29', firstName: 'Linda', lastName: 'Martinez' },
//         { netid: 'paulf31', firstName: 'Paul', lastName: 'Fisher' },
//         { netid: 'markl13', firstName: 'Mark', lastName: 'Lewis' },
//         { netid: 'carolynb59', firstName: 'Carolyn', lastName: 'Barnes' },
//         { netid: 'nataliep71', firstName: 'Natalie', lastName: 'Price' },

//         { netid: 'ethanc12', firstName: 'Ethan', middleName: 'Yuting', lastName: 'Chang' },
//         { netid: 'sarahg23', firstName: 'Sarah', middleName: 'Grace', lastName: 'Gonzalez' },
//         { netid: 'annaw02', firstName: 'Anna', middleName: 'Marie', lastName: 'Williams' },
//         { netid: 'laurenp87', firstName: 'Lauren', middleName: 'Patricia', lastName: 'Perez' },
//         { netid: 'kevink11', firstName: 'Kevin', middleName: 'Lee', lastName: 'Kim' },
//         { netid: 'mattt92', firstName: 'Matthew', middleName: 'Thomas', lastName: 'Taylor' },
//         { netid: 'stephenj45', firstName: 'Stephen', middleName: 'James', lastName: 'Johnson' },
//         { netid: 'victorc16', firstName: 'Victor', middleName: 'Charles', lastName: 'Carter' },
//         { netid: 'susana80', firstName: 'Susan', middleName: 'Ann', lastName: 'Anderson' },
//         { netid: 'patrickh37', firstName: 'Patrick', middleName: 'Henry', lastName: 'Hill' },
//       ];

//       const mergedResponse: User[] = userOrgsResponse.map((orgObj) => {
//         const nameObj = userNamesResponse.find((name) => name.netid === orgObj.netid);
//         return { ...orgObj, ...nameObj } as User;
//       });

//       setUserList(mergedResponse);
//     };
//     getUsers();
//   }, []);

//   const removeUser = async (netid: string) => {
//     try {
//       // await api.delete(`/api/v1/events/${eventId}`);
//       setUserList((prevUsers) => prevUsers.filter((u) => u.netid !== netid));
//       notifications.show({
//         title: 'User removed',
//         message: 'The user was successfully removed.',
//       });
//       close();
//     } catch (error) {
//       console.error(error);
//       notifications.show({
//         title: 'Error removing user',
//         message: `${error}`,
//         color: 'red',
//       });
//     }
//   };

//   if (userList.length === 0) {
//     return <FullScreenLoader />;
//   }

//   return (
//     <AuthGuard resourceDef={{ service: 'core', validRoles: [AppRoles.IAM_ADMIN] }}>
//       {userRemoved && (
//         <Modal
//           opened={opened}
//           onClose={() => {
//             setRemoveUser(null);
//             close();
//           }}
//           title="Confirm action"
//         >
//           <Text>
//             Are you sure you want to remove the user <i>{userRemoved?.netid}</i>?
//           </Text>
//           <hr />
//           <Group>
//             <Button
//               leftSection={<IconTrash />}
//               onClick={() => {
//                 removeUser(userRemoved?.netid);
//               }}
//             >
//               Delete
//             </Button>
//           </Group>
//         </Modal>
//       )}
//       {/* <div style={{ display: 'flex', columnGap: '1vw', verticalAlign: 'middle' }}>
//         <Button
//           leftSection={<IconPlus size={14} />}
//           onClick={() => {
//             navigate('/events/add');
//           }}
//         >
//           New Calendar Event
//         </Button>
//         <Button onClick={togglePrevious}>
//           {showPrevious ? 'Hide Previous Events' : 'Show Previous Events'}
//         </Button>
//       </div> */}
//       <Table style={{ tableLayout: 'fixed', width: '100%' }} data-testid="users-table">
//         <Table.Thead>
//           <Table.Tr>
//             <Table.Th>NetID</Table.Th>
//             <Table.Th>First Name</Table.Th>
//             <Table.Th>Middle Name</Table.Th>
//             <Table.Th>Last Name</Table.Th>
//             <Table.Th>Organization</Table.Th>
//             <Table.Th>Actions</Table.Th>
//           </Table.Tr>
//         </Table.Thead>
//         <Table.Tbody>{userList.map(renderTableRow)}</Table.Tbody>
//       </Table>
//     </AuthGuard>
//   );
// };
