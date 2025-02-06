import { Box, Card, Divider, Text, Title } from '@mantine/core';
import { IconAlertCircle, IconCircleCheck } from '@tabler/icons-react';
import React, { useState } from 'react';
import { GetInvoiceLinksResponse } from '@common/types/stripe';
import FullScreenLoader from '@ui/components/AuthContext/LoadingScreen';

interface StripeCurrentLinksPanelProps {
  links: GetInvoiceLinksResponse;
  isLoading: boolean;
}

export const StripeCurrentLinksPanel: React.FC<StripeCurrentLinksPanelProps> = ({
  links,
  isLoading,
}) => {
  return (
    <div>
      <Title order={2} mb="sm">
        Current Links
      </Title>
      <Text>Coming soon!</Text>
    </div>
  );
};

export default StripeCurrentLinksPanel;
