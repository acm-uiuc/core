import { Box, Button, Textarea, Text, Modal, Alert, Group, List, ListItem } from '@mantine/core';
import { IconAlertCircle, IconCircleCheck } from '@tabler/icons-react';
import React, { useState } from 'react';
import { InvitePostResponse } from '@common/types/iam';

interface UserInvitePanelProps {
  onSubmit: (emails: string[]) => Promise<InvitePostResponse>;
}

interface ErrorModalState {
  open: boolean;
  email: string;
  message: string;
}

export const UserInvitePanel: React.FC<UserInvitePanelProps> = ({ onSubmit }) => {
  const [emails, setEmails] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [results, setResults] = useState<InvitePostResponse | null>(null);
  const [errorModal, setErrorModal] = useState<ErrorModalState>({
    open: false,
    email: '',
    message: '',
  });

  const handleSubmit = async () => {
    try {
      setIsSubmitting(true);
      // Split emails by newline and filter out empty lines
      const emailList = emails
        .split('\n')
        .map((email) => email.trim())
        .filter((email) => email.length > 0);

      const response = await onSubmit(emailList);
      setResults(response);
      // Clear input on success
      if (response.success?.length && !response.failure?.length) {
        setEmails('');
      }
    } catch (error) {
      console.error('Failed to invite users:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const showErrorDetails = (email: string, message: string) => {
    setErrorModal({ open: true, email, message });
  };

  return (
    <Box p="md">
      <Box mb="md">
        <Text fw={500} mb={4}>
          Add Users to Entra ID Tenant
        </Text>
        <Text size="sm" color="dimmed" mb="sm">
          Enter <code>illinois.edu</code> emails (one per line). Paid members are already added to
          the tenant.
        </Text>
        <Textarea
          value={emails}
          onChange={(event) => setEmails(event.currentTarget.value)}
          minRows={4}
          maxRows={8}
          placeholder="user@illinois.edu&#10;another@illinois.edu"
          disabled={isSubmitting}
        />
      </Box>

      <Button
        fullWidth
        onClick={handleSubmit}
        disabled={!emails.trim() || isSubmitting}
        loading={isSubmitting}
      >
        {isSubmitting ? 'Sending Invites...' : 'Send Invites'}
      </Button>

      {results && (
        <Box mt="md" className="space-y-2">
          {results.success && results.success.length > 0 ? (
            <Alert
              icon={<IconCircleCheck size={16} />}
              color="green"
              title="Successful Invitations"
            >
              <Box>
                <List>
                  {results.success.map(({ email }) => (
                    <ListItem>
                      <Group key={email} mb="xs">
                        <Text size="sm">{email}</Text>
                      </Group>
                    </ListItem>
                  ))}
                </List>
              </Box>
            </Alert>
          ) : null}

          {results.failure?.length ? (
            <Alert icon={<IconAlertCircle size={16} />} color="red" title="Failed Invitations">
              <Box>
                <List>
                  {results.failure.map(({ email, message }) => (
                    <ListItem>
                      <Group key={email} mb="xs">
                        <Text size="sm">{email}</Text>
                        <Button
                          variant="subtle"
                          size="xs"
                          onClick={() => showErrorDetails(email, message)}
                        >
                          View Details
                        </Button>
                      </Group>
                    </ListItem>
                  ))}
                </List>
              </Box>
            </Alert>
          ) : null}
        </Box>
      )}

      <Modal
        opened={errorModal.open}
        onClose={() => setErrorModal({ open: false, email: '', message: '' })}
        title="Invitation Error"
        size="md"
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
    </Box>
  );
};

export default UserInvitePanel;
