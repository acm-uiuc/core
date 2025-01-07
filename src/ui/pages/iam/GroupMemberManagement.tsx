import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Text,
  TextInput,
  Group,
  Modal,
  List,
  ListItem,
  ScrollArea,
  Badge,
  ActionIcon,
} from '@mantine/core';
import { IconTrash, IconUserPlus } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { GroupMemberGetResponse, EntraActionResponse } from '@common/types/iam';

interface GroupMemberManagementProps {
  fetchMembers: () => Promise<GroupMemberGetResponse>;
  updateMembers: (toAdd: string[], toRemove: string[]) => Promise<EntraActionResponse>;
}

export const GroupMemberManagement: React.FC<GroupMemberManagementProps> = ({
  fetchMembers,
  updateMembers,
}) => {
  const [members, setMembers] = useState<GroupMemberGetResponse>([]);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const [toRemove, setToRemove] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [confirmationModal, setConfirmationModal] = useState(false);

  useEffect(() => {
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
      }
    };
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
      if (response.success) {
        setMembers((prev) =>
          prev
            .filter((member) => !toRemove.includes(member.email))
            .concat(toAdd.map((email) => ({ name: '', email })))
        );
        setToAdd([]);
        setToRemove([]);
      }

      notifications.show({
        title: 'Success',
        message: 'Changes saved successfully!',
        color: 'green',
      });
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

  return (
    <Box p="md">
      <Text fw={500} mb={4}>
        Exec Group Management
      </Text>

      {/* Member List */}
      <Box mb="md">
        <Text size="sm" fw={500} mb="xs">
          Current Members
        </Text>
        <ScrollArea style={{ height: 250 }}>
          <List spacing="sm">
            {members.map((member) => (
              <ListItem key={member.email}>
                <Group justify="space-between">
                  <Box>
                    <Text size="sm">
                      {member.name} ({member.email})
                    </Text>
                    {toRemove.includes(member.email) && (
                      <Badge color="green" size="sm">
                        Queued for removal
                      </Badge>
                    )}
                  </Box>
                  <ActionIcon
                    color="red"
                    variant="light"
                    onClick={() => handleRemoveMember(member.email)}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              </ListItem>
            ))}
            {toAdd.map((member) => (
              <ListItem key={member}>
                <Group justify="space-between">
                  <Box>
                    <Text size="sm">{member}</Text>
                    <Badge color="red" size="sm">
                      Queued for addition
                    </Badge>
                  </Box>
                </Group>
              </ListItem>
            ))}
          </List>
        </ScrollArea>
      </Box>

      {/* Add Member */}
      <Box mb="md">
        <TextInput
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          placeholder="Enter email"
          label="Add Member"
        />
        <Button
          mt="sm"
          leftSection={<IconUserPlus size={16} />}
          onClick={handleAddMember}
          disabled={isLoading}
        >
          Add Member
        </Button>
      </Box>

      {/* Save Changes Button */}
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

      {/* Confirmation Modal */}
      <Modal
        opened={confirmationModal}
        onClose={() => setConfirmationModal(false)}
        title="Confirm Changes"
      >
        <Box>
          {toAdd.length > 0 && (
            <Box mb="md">
              <Text fw={500} size="sm">
                Members to Add:
              </Text>
              <List spacing="sm">
                {toAdd.map((email) => (
                  <ListItem key={email}>{email}</ListItem>
                ))}
              </List>
            </Box>
          )}
          {toRemove.length > 0 && (
            <Box mb="md">
              <Text fw={500} size="sm">
                Members to Remove:
              </Text>
              <List spacing="sm">
                {toRemove.map((email) => (
                  <ListItem key={email}>{email}</ListItem>
                ))}
              </List>
            </Box>
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
        </Box>
      </Modal>
    </Box>
  );
};

export default GroupMemberManagement;