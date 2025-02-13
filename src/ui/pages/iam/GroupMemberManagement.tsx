import React, { useState, useEffect } from 'react';
import {
  Avatar,
  Badge,
  Group,
  Table,
  Text,
  Button,
  TextInput,
  Modal,
  Loader,
  Skeleton,
} from '@mantine/core';
import { IconUserPlus, IconTrash } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { GroupMemberGetResponse, EntraActionResponse } from '@common/types/iam';

interface GroupMemberManagementProps {
  fetchMembers: () => Promise<GroupMemberGetResponse>;
  updateMembers: (toAdd: string[], toRemove: string[]) => Promise<EntraActionResponse>;
}

const GroupMemberManagement: React.FC<GroupMemberManagementProps> = ({
  fetchMembers,
  updateMembers,
}) => {
  const [members, setMembers] = useState<GroupMemberGetResponse>([]);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const [toRemove, setToRemove] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [confirmationModal, setConfirmationModal] = useState(false);
  const loadMembers = async () => {
    try {
      const memberList = await fetchMembers();
      setMembers(memberList);
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: 'Failed to retrieve members.',
        color: 'red',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMembers();
  }, [fetchMembers]);

  const handleAddMember = () => {
    if (email && !members.some((member) => member.email === email) && !toAdd.includes(email)) {
      setToAdd((prev) => [...prev, email]);
      setEmail('');
    } else {
      notifications.show({
        title: 'Invalid Input',
        message: 'Email is missing or the user already exists.',
        color: 'orange',
      });
    }
  };

  const handleRemoveMember = (email: string) => {
    if (!toRemove.includes(email)) {
      setToRemove((prev) => [...prev, email]);
    }
  };

  const handleSaveChanges = async () => {
    setIsLoading(true);
    try {
      const response = await updateMembers(toAdd, toRemove);
      const { success = [], failure = [] } = response;

      const successfulAdds = success.filter((entry) => toAdd.includes(entry.email));
      const successfulRemoves = success.filter((entry) => toRemove.includes(entry.email));

      setMembers((prev) =>
        prev
          .filter((member) => !successfulRemoves.some((remove) => remove.email === member.email))
          .concat(successfulAdds.map(({ email }) => ({ name: email.split('@')[0], email })))
      );
      loadMembers();
      setToAdd([]);
      setToRemove([]);

      if (failure.length === 0) {
        notifications.show({
          title: 'Success',
          message: 'All changes processed successfully!',
          color: 'green',
        });
      } else {
        failure.forEach(({ email, message }) => {
          notifications.show({
            title: `Error with ${email}`,
            message,
            color: 'red',
          });
        });
      }
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: 'Failed to save changes.',
        color: 'red',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const rows = [
    ...members.map((member) => (
      <Table.Tr key={member.email}>
        <Table.Td>
          <Group gap="sm">
            <Avatar name={member.name || member.email[0]} color="initials"></Avatar>
            <div>
              <Text fz="sm" fw={500}>
                {member.name}
              </Text>
              <Text fz="xs" c="dimmed">
                {member.email}
              </Text>
            </div>
          </Group>
        </Table.Td>
        <Table.Td>
          {toRemove.includes(member.email) ? (
            <Badge color="red" variant="light">
              Queued for removal
            </Badge>
          ) : (
            <Badge color="green" variant="light">
              Active
            </Badge>
          )}
        </Table.Td>
        <Table.Td>
          <Button
            color="red"
            variant="light"
            size="xs"
            onClick={() => handleRemoveMember(member.email)}
            leftSection={<IconTrash size={14} />}
          >
            Remove
          </Button>
        </Table.Td>
      </Table.Tr>
    )),
    ...toAdd.map((email) => (
      <Table.Tr key={email}>
        <Table.Td>
          <Group gap="sm">
            <Avatar name={email} color="initials"></Avatar>
            <div>
              <Text fz="sm" fw={500}>
                {email.split('@')[0]}
              </Text>
              <Text fz="xs" c="dimmed">
                {email}
              </Text>
            </div>
          </Group>
        </Table.Td>
        <Table.Td>
          <Badge color="blue" variant="light">
            Queued for addition
          </Badge>
        </Table.Td>
        <Table.Td>
          <Button
            color="red"
            variant="light"
            size="xs"
            onClick={() => setToAdd((prev) => prev.filter((item) => item !== email))}
            leftSection={<IconTrash size={14} />}
          >
            Cancel
          </Button>
        </Table.Td>
      </Table.Tr>
    )),
  ];

  return (
    <div>
      <Table verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Member</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading ? (
            <Table.Tr key="skeleton">
              <Table.Td>
                <Skeleton visible={true}>
                  <Group gap="sm">
                    <Avatar name={email} color="initials"></Avatar>
                    <div>
                      <Text fz="sm" fw={500}>
                        Johnathan Doe
                      </Text>
                      <Text fz="xs" c="dimmed">
                        jdoe@illinois.edu
                      </Text>
                    </div>
                  </Group>
                </Skeleton>
              </Table.Td>
              <Table.Td>
                <Skeleton visible={true}>
                  <Badge color="blue" variant="light"></Badge>
                </Skeleton>
              </Table.Td>
              <Table.Td>
                <Skeleton visible={true}>
                  <Button
                    color="red"
                    variant="light"
                    size="xs"
                    leftSection={<IconTrash size={14} />}
                  >
                    Remove
                  </Button>
                </Skeleton>
              </Table.Td>
            </Table.Tr>
          ) : (
            rows
          )}
        </Table.Tbody>
      </Table>

      <TextInput
        value={email}
        onChange={(e) => setEmail(e.currentTarget.value)}
        placeholder="Enter email"
        label="Add Member"
        mt="md"
      />
      <Button
        mt="sm"
        leftSection={<IconUserPlus size={16} />}
        onClick={handleAddMember}
        disabled={isLoading}
      >
        Add Member
      </Button>

      <Button
        fullWidth
        color="blue"
        mt="md"
        onClick={() => setConfirmationModal(true)}
        disabled={!toAdd.length && !toRemove.length}
        loading={isLoading}
      >
        Save Changes
      </Button>

      <Modal
        opened={confirmationModal}
        onClose={() => setConfirmationModal(false)}
        title="Confirm Changes"
      >
        <div>
          {toAdd.length > 0 && (
            <div>
              <Text fw={500} size="sm" mb="xs">
                Members to Add:
              </Text>
              {toAdd.map((email) => (
                <Text key={email}>{email}</Text>
              ))}
            </div>
          )}
          {toRemove.length > 0 && (
            <div>
              <Text fw={500} size="sm" mt="md" mb="xs">
                Members to Remove:
              </Text>
              {toRemove.map((email) => (
                <Text key={email}>{email}</Text>
              ))}
            </div>
          )}
          <Group justify="center" mt="lg">
            <Button
              onClick={() => {
                handleSaveChanges();
                setConfirmationModal(false);
              }}
              loading={isLoading}
              color="blue"
            >
              Confirm and Save
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirmationModal(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
          </Group>
        </div>
      </Modal>
    </div>
  );
};

export default GroupMemberManagement;
