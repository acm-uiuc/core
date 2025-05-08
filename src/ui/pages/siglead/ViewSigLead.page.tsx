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
  Modal,
  Text,
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
import { SigDetailRecord, SigMemberRecord } from '@common/types/siglead.js';
import { IconCancel, IconCross, IconEdit, IconPlus, IconTrash } from '@tabler/icons-react';
import { useDisclosure } from '@mantine/hooks';

export const ViewSigLeadPage: React.FC = () => {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isAddingMember, setIsAddingMember] = useState<boolean>(false);
  const [opened, { open, close }] = useDisclosure(false);
  const navigate = useNavigate();
  const api = useApi('core');
  const { colorScheme } = useMantineColorScheme();
  const { sigId } = useParams();
  const [sigMembers, setSigMembers] = useState<SigMemberRecord[]>([]);
  const [sigDetails, setSigDetails] = useState<SigDetailRecord>({
    sigid: sigId || '',
    signame: 'Default Sig',
    description:
      'A cool Sig with a lot of money and members. Founded in 1999 by Sir Charlie of Edinburgh. Focuses on making money and helping others earn more money via education.',
  });

  const form = useForm<SigMemberRecord>({
    //validate: zodResolver(requestBodySchema),
    initialValues: {
      sigGroupId: sigId || '',
      email: '',
      designation: 'M',
      memberName: '',
    },
  });

  useEffect(() => {
    // Fetch sig data and populate form
    const getSig = async () => {
      try {
        /*const formValues = { 
          };
          form.setValues(formValues);*/
        const sigMemberRequest = await api.get(`/api/v1/siglead/sigmembers/${sigId}`);
        setSigMembers(sigMemberRequest.data);

        const sigDetailRequest = await api.get(`/api/v1/siglead/sigdetail/${sigId}`);
        setSigDetails(sigDetailRequest.data);
      } catch (error) {
        console.error('Error fetching sig data:', error);
        notifications.show({
          message: 'Failed to fetch sig data, please try again.',
        });
      }
    };
    getSig();
  }, [sigId]);

  const renderSigMember = (member: SigMemberRecord, index: number) => {
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
            <Table.Td>{member.memberName}</Table.Td>
            <Table.Td>{member.email}</Table.Td>
            <Table.Td>{member.designation}</Table.Td>
          </tr>
        )}
      </Transition>
    );
  };

  const handleSubmit = async (values: SigMemberRecord) => {
    try {
      setIsSubmitting(true);

      values.sigGroupId = sigDetails.sigid;

      const submitURL = `/api/v1/siglead/addMember/${sigDetails.sigid}`;
      const response = await api.post(submitURL, values);
      notifications.show({
        title: 'Member added!',
        message: '',
      });
      setIsAddingMember(false);
    } catch (error: any) {
      setIsSubmitting(false);
      console.error('Error adding member:', error);
      notifications.show({
        title: 'Failed to add member, please try again.',
        message: error.response && error.response.data ? error.response.data.message : undefined,
      });
    }
  };

  return (
    <AuthGuard resourceDef={{ service: 'core', validRoles: [AppRoles.SIGLEAD_MANAGER] }}>
      <Container>
        <Group align="flex-start">
          <Box style={{ flex: 8 }}>
            <Title order={1}>{sigDetails.signame}</Title>
            {sigDetails.description || ''}
          </Box>
          <Box style={{ flex: 1, textAlign: 'right', alignItems: 'right' }}>
            <Stack>
              <Button variant="white">Member Count: {sigMembers.length}</Button>

              <Button
                onClick={() => {
                  setIsAddingMember(true);
                  open();
                }}
              >
                Add Member
              </Button>
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
            <Table.Tbody>
              {sigMembers.length > 0 ? sigMembers.map(renderSigMember) : <></>}
            </Table.Tbody>
          </Table>
        </div>
      </Container>
      <Modal
        opened={opened}
        onClose={() => {
          setIsAddingMember(false);
          close();
        }}
        title={`Add Member to ${sigDetails.signame}`}
      >
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <TextInput
            label="Member Name"
            withAsterisk
            placeholder="John Doe"
            {...form.getInputProps('memberName')}
          />
          <TextInput
            label="Member Email"
            withAsterisk
            placeholder="jdoe@illinois.edu"
            {...form.getInputProps('email')}
          />
          <hr />
          <Group>
            <Button type="submit" leftSection={<IconPlus />} color="Green">
              {isSubmitting ? (
                <>
                  <Loader size={16} color="white" />
                  Submitting...
                </>
              ) : (
                'Add Member'
              )}
            </Button>

            <Button
              leftSection={<IconCancel />}
              onClick={() => {
                close(); // Close the modal
              }}
            >
              Cancel
            </Button>
          </Group>
        </form>
      </Modal>
    </AuthGuard>
  );
};
