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
  Alert,
  ActionIcon,
  ScrollArea,
  Badge,
} from '@mantine/core';
import { IconTrash, IconCheck, IconX } from '@tabler/icons-react';
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
  const [results, setResults] = useState<
    { email: string; status: 'success' | 'failure'; message?: string }[]
  >([]);
  const [email, setEmail] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [confirmationModal, setConfirmationModal] = useState<boolean>(false);
  const [errorModal, setErrorModal] = useState<{ open: boolean; email: string; message: string }>({
    open: false,
    email: '',
    message: '',
  });

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
    }
  };

  const handleRemoveMember = (email: string) => {
    if (!toRemove.includes(email)) {
      setToRemove((prev) => [...prev, email]);
    }
  };

  const handleSaveChanges = async () => {
    setIsLoading(true);
    const newResults: { email: string; status: 'success' | 'failure'; message?: string }[] = [];

    try {
      const response = await updateMembers(toAdd, toRemove);
      response.success?.forEach(({ email }) => {
        newResults.push({ email, status: 'success' });
      });
      response.failure?.forEach(({ email, message }) => {
        newResults.push({ email, status: 'failure', message });
      });
      setResults(newResults);
      setToAdd([]);
      setToRemove([]);
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: 'An error occurred while saving changes.',
        color: 'red',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleViewErrorDetails = (email: string, message: string) => {
    setErrorModal({ open: true, email, message });
  };

  return (
    <Box p="md">
      <Text fw={500} mb={4}>
        Group Member Management
      </Text>

      {/* Member List */}
      <Box mb="md">
        <Text size="sm" fw={500} mb="xs">
          Current Members
        </Text>
        <ScrollArea style={{ height: 200 }}>
          <List>
            {members.map((member) => (
              <ListItem key={member.email}>
                <Group position="apart">
                  <Text size="sm">{member.email}</Text>
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
          </List>
        </ScrollArea>
      </Box>

      {/* Add Member */}
      <Box mb="md">
        <TextInput
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          placeholder="Enter email to add"
          disabled={isLoading}
        />
        <Button mt="sm" onClick={handleAddMember} disabled={!email.trim() || isLoading}>
          Add Member
        </Button>
      </Box>

      {/* Save Changes Button */}
      <Button
        fullWidth
        color="blue"
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
        size="md"
      >
        <Box>
          {toAdd.length > 0 && (
            <Box mb="md">
              <Text fw={500} size="sm">
                Members to Add:
              </Text>
              <ScrollArea style={{ height: 100 }}>
                <List>
                  {toAdd.map((email) => (
                    <ListItem key={email}>
                      <Text size="sm">{email}</Text>
                    </ListItem>
                  ))}
                </List>
              </ScrollArea>
            </Box>
          )}
          {toRemove.length > 0 && (
            <Box mb="md">
              <Text fw={500} size="sm">
                Members to Remove:
              </Text>
              <ScrollArea style={{ height: 100 }}>
                <List>
                  {toRemove.map((email) => (
                    <ListItem key={email}>
                      <Text size="sm">{email}</Text>
                    </ListItem>
                  ))}
                </List>
              </ScrollArea>
            </Box>
          )}
          <Group position="center" mt="lg">
            <Button onClick={handleSaveChanges} loading={isLoading} color="blue">
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

      {/* Results */}
      {results.length > 0 && (
        <Box mt="md">
          <Text fw={500} size="sm" mb="xs">
            Results
          </Text>
          <List>
            {results.map(({ email, status, message }) => (
              <ListItem key={email}>
                <Group position="apart">
                  <Text size="sm">{email}</Text>
                  <Group>
                    <Badge color={status === 'success' ? 'green' : 'red'}>
                      {status === 'success' ? 'Success' : 'Failure'}
                    </Badge>
                    {status === 'failure' && (
                      <Button
                        variant="subtle"
                        size="xs"
                        onClick={() => handleViewErrorDetails(email, message || 'Unknown error')}
                      >
                        View Details
                      </Button>
                    )}
                  </Group>
                </Group>
              </ListItem>
            ))}
          </List>
        </Box>
      )}

      {/* Error Modal */}
      <Modal
        opened={errorModal.open}
        onClose={() => setErrorModal({ open: false, email: '', message: '' })}
        title="Error Details"
      >
        <Box>
          <Text fw={500} size="sm" mb={2}>
            Email:
          </Text>
          <Text size="sm" mb="md">
            {errorModal.email}
          </Text>
          <Text fw={500} size="sm" mb={2}>
            Error Message:
          </Text>
          <Text size="sm" mb="md">
            {errorModal.message}
          </Text>
          <Button fullWidth onClick={() => setErrorModal({ open: false, email: '', message: '' })}>
            Close
          </Button>
        </Box>
      </Modal>

      {/* Notifications for Feedback */}
      {isLoading && (
        <Alert color="blue" title="Processing Changes" mt="md">
          Please wait while the changes are being processed.
        </Alert>
      )}
    </Box>
  );
};

export default GroupMemberManagement;
