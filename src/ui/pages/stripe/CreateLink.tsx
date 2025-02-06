import {
  Box,
  Button,
  Card,
  Divider,
  Text,
  TextInput,
  NumberInput,
  Title,
  Modal,
  Anchor,
  CopyButton,
  Group,
  Loader,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle } from '@tabler/icons-react';
import React, { useState } from 'react';
import { PostInvoiceLinkRequest, PostInvoiceLinkResponse } from '@common/types/stripe';
import FullScreenLoader from '@ui/components/AuthContext/LoadingScreen';

interface StripeCreateLinkPanelProps {
  createLink: (payload: PostInvoiceLinkRequest) => Promise<PostInvoiceLinkResponse>;
  isLoading: boolean;
}

export const StripeCreateLinkPanel: React.FC<StripeCreateLinkPanelProps> = ({
  createLink,
  isLoading,
}) => {
  const [modalOpened, setModalOpened] = useState(false);
  const [returnedLink, setReturnedLink] = useState<string | null>(null);

  const form = useForm({
    initialValues: {
      invoiceId: '',
      invoiceAmountUsd: 100,
      contactName: '',
      contactEmail: '',
    },
    validate: {
      invoiceId: (value) => (value.length < 1 ? 'Invoice ID is required' : null),
      invoiceAmountUsd: (value) => (value < 0.5 ? 'Amount must be at least $0.50' : null),
      contactName: (value) => (value.length < 1 ? 'Contact Name is required' : null),
      contactEmail: (value) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : 'Invalid email'),
    },
  });

  const handleSubmit = async (values: typeof form.values) => {
    try {
      const response = await createLink(values);
      setReturnedLink(response.link);
      setModalOpened(true);
      form.reset();
    } catch (err) {
      notifications.show({
        title: 'Error',
        message: 'Failed to create payment link. Please try again or contact support.',
        color: 'red',
        icon: <IconAlertCircle size={16} />,
      });
    }
  };

  return (
    <Box mt="xl" mb="xl">
      <Title order={2} mb="sm">
        Create a Payment Link
      </Title>
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <TextInput
          label="Invoice ID"
          placeholder="ACM100"
          description="Make sure the Invoice ID is prefixed with a unique string for your group to avoid processing delays."
          {...form.getInputProps('invoiceId')}
          required
        />
        <NumberInput
          label="Invoice Amount"
          leftSectionPointerEvents="none"
          leftSection={<Text>$</Text>}
          placeholder="100"
          min={0.5}
          {...form.getInputProps('invoiceAmountUsd')}
          required
        />
        <TextInput
          label="Invoice Recipient Name"
          placeholder="John Doe"
          {...form.getInputProps('contactName')}
          required
        />
        <TextInput
          label="Invoice Recipient Email"
          placeholder="email@illinois.edu"
          {...form.getInputProps('contactEmail')}
          required
        />

        <Button type="submit" fullWidth mt="md" disabled={isLoading}>
          {isLoading ? 'Creating...' : 'Create Link'}{' '}
          {isLoading && <Loader color="blue" size="sm" ml="sm" />}
        </Button>
      </form>

      <Modal
        opened={modalOpened}
        size="xl"
        onClose={() => setModalOpened(false)}
        title="Payment Link Created!"
        closeOnClickOutside={false}
        withCloseButton={true}
      >
        {returnedLink && (
          <Box mt="md">
            <Group>
              <Text color="blue">{returnedLink}</Text>
              <CopyButton value={returnedLink}>
                {({ copied, copy }) => (
                  <Button color={copied ? 'teal' : 'blue'} onClick={copy}>
                    {copied ? 'Copied!' : 'Copy Link'}
                  </Button>
                )}
              </CopyButton>
            </Group>
            <Text mt="sm">Provide this link to your billing contact for payment.</Text>
          </Box>
        )}
      </Modal>
    </Box>
  );
};

export default StripeCreateLinkPanel;
