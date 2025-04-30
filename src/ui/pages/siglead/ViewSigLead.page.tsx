import {
  Title,
  Box,
  TextInput,
  Textarea,
  Switch,
  Select,
  Button,
  Loader,
  Container,
  Transition,
  useMantineColorScheme,
  Table,
  Group,
  Stack,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useForm, zodResolver } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import dayjs from 'dayjs';
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { AuthGuard } from '@ui/components/AuthGuard';
import { getRunEnvironmentConfig } from '@ui/config';
import { useApi } from '@ui/util/api';
import { AppRoles } from '@common/roles';
import { IconUsersGroup } from '@tabler/icons-react';

const baseSigSchema = z.object({
  sigid: z.string().min(1),
  signame: z.string().min(1),
  description: z.string().optional(),
});

const baseSigMemberSchema = z.object({
  sigGroupId: z.string().min(1),
  email: z.string().email('Invalid email'),
  designation: z.enum(['L', 'M']),
  id: z.string().optional(),
  memberName: z.string(),
});

type sigDetails = z.infer<typeof baseSigSchema>;
type sigMemberDetails = z.infer<typeof baseSigMemberSchema>;

export const ViewSigLeadPage: React.FC = () => {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const navigate = useNavigate();
  const api = useApi('core');
  const { colorScheme } = useMantineColorScheme();
  const { sigId } = useParams();
  const [sigMembers, setSigMembers] = useState<sigMemberDetails[]>([]);
  const [sigDetails, setSigDetails] = useState<sigDetails>();

  useEffect(() => {
    // Fetch sig data and populate form / for now dummy data...
    const getSig = async () => {
      try {
        const sigDetailsData = await api.get(`/api/v1/siglead/sigdetail/${sigId}`);
        setSigDetails(sigDetailsData.data);
        const sigMembersData = await api.get(`/api/v1/siglead/sigmembers/${sigId}`);
        setSigMembers(sigMembersData.data);
      } catch (error) {
        console.error('Error fetching sig data:', error);
        notifications.show({
          message: 'Failed to fetch sig data, please try again.',
        });
      }
    };
    getSig();
  }, [sigId]);

  const renderSigMember = (members: sigMemberDetails, index: number) => {
    const shouldShow = true;
    return (
      <Transition mounted={shouldShow} transition="fade" duration={10000} timingFunction="ease">
        {(styles) => (
          <tr
            style={{
              ...styles,
              display: shouldShow ? 'table-row' : 'none',
              backgroundColor:
                colorScheme === 'dark'
                  ? index % 2 === 0
                    ? '#333333'
                    : '#444444'
                  : index % 2 === 0
                    ? '#f0f8ff'
                    : '#ffffff',
            }}
          >
            <Table.Td>{members.memberName}</Table.Td>
            <Table.Td>{members.email}</Table.Td>
            <Table.Td>{members.designation}</Table.Td>
          </tr>
        )}
      </Transition>
    );
  };

  /*
    const form = useForm<EventPostRequest>({
      validate: zodResolver(requestBodySchema),
      initialValues: {
        title: '',
        description: '',
        start: new Date(),
        end: new Date(new Date().valueOf() + 3.6e6), // 1 hr later
        location: 'ACM Room (Siebel CS 1104)',
        locationLink: 'https://maps.app.goo.gl/dwbBBBkfjkgj8gvA8',
        host: 'ACM',
        featured: false,
        repeats: undefined,
        repeatEnds: undefined,
        paidEventId: undefined,
      },
    });
    /*
    const handleSubmit = async (values: EventPostRequest) => {
      try {
        setIsSubmitting(true);
        const realValues = {
          ...values,
          start: dayjs(values.start).format('YYYY-MM-DD[T]HH:mm:00'),
          end: values.end ? dayjs(values.end).format('YYYY-MM-DD[T]HH:mm:00') : undefined,
          repeatEnds:
            values.repeatEnds && values.repeats
              ? dayjs(values.repeatEnds).format('YYYY-MM-DD[T]HH:mm:00')
              : undefined,
          repeats: values.repeats ? values.repeats : undefined,
        };
  
        const eventURL = isEditing ? `/api/v1/events/${eventId}` : '/api/v1/events';
        const response = await api.post(eventURL, realValues);
        notifications.show({
          title: isEditing ? 'Event updated!' : 'Event created!',
          message: isEditing ? undefined : `The event ID is "${response.data.id}".`,
        });
        navigate('/events/manage');
      } catch (error) {
        setIsSubmitting(false);
        console.error('Error creating/editing event:', error);
        notifications.show({
          message: 'Failed to create/edit event, please try again.',
        });
      }
    };*/

  return (
    <AuthGuard resourceDef={{ service: 'core', validRoles: [AppRoles.SIGLEAD_MANAGER] }}>
      <Container>
        <Group align="flex-start">
          <Box style={{ flex: 8 }}>
            <Title order={1}>{sigDetails?.signame}</Title>
            {sigDetails?.description || ''}
          </Box>
          <Box style={{ flex: 1, textAlign: 'right', alignItems: 'right' }}>
            <Stack>
              <Button variant="white" leftSection={<IconUsersGroup />}>
                Member Count: {sigMembers.length}
              </Button>
              <Button>Add Member</Button>
              <Button
                onClick={() => navigate('../siglead-management')}
                variant="outline"
                color="gray"
              >
                Back
              </Button>
            </Stack>
          </Box>
        </Group>
        <div style={{ width: '100%', overflowX: 'auto' }}>
          <Table style={{ tableLayout: 'fixed', width: '100%' }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Email</Table.Th>
                <Table.Th>Roles</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>{sigMembers.map(renderSigMember)}</Table.Tbody>
          </Table>
        </div>
      </Container>
    </AuthGuard>
  );
};
