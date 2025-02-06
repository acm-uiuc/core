import React, { useState } from 'react';
import { Card, Container, Divider, Title, Text } from '@mantine/core';
import { AuthGuard } from '@ui/components/AuthGuard';
import { AppRoles } from '@common/roles';
import StripeCurrentLinksPanel from './CurrentLinks';
import StripeCreateLinkPanel from './CreateLink';
import { PostInvoiceLinkRequest, PostInvoiceLinkResponse } from '@common/types/stripe';
import { useApi } from '@ui/util/api';

export const ManageStripeLinksPage: React.FC = () => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const api = useApi('core');

  const createLink = async (payload: PostInvoiceLinkRequest): Promise<PostInvoiceLinkResponse> => {
    setIsLoading(true);
    const modifiedPayload = { ...payload, invoiceAmountUsd: payload.invoiceAmountUsd * 100 };
    try {
      const response = await api.post('/api/v1/stripe/paymentLinks', modifiedPayload);
      setIsLoading(false);
      return response.data;
    } catch (e) {
      setIsLoading(false);
      throw e;
    }
  };

  return (
    <AuthGuard
      resourceDef={{ service: 'core', validRoles: [AppRoles.STRIPE_LINK_CREATOR] }}
      showSidebar={true}
    >
      <Container>
        <Title>Stripe Link Creator</Title>
        <Text>Create a Stripe Payment Link to accept credit card payments.</Text>
        <StripeCreateLinkPanel
          createLink={createLink}
          isLoading={isLoading}
        ></StripeCreateLinkPanel>
        <StripeCurrentLinksPanel links={[]} isLoading={isLoading} />
      </Container>
    </AuthGuard>
  );
};
