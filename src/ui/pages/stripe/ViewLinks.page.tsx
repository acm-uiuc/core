import React from 'react';
import { Container, Title } from '@mantine/core';
import { AuthGuard } from '@ui/components/AuthGuard';
import { AppRoles } from '@common/roles';

export const ManageStripeLinksPage: React.FC = () => {
  return (
    <AuthGuard
      resourceDef={{ service: 'core', validRoles: [AppRoles.STRIPE_LINK_CREATOR] }}
      showSidebar={true}
    >
      <Container fluid>
        <Title>Stripe Links</Title>
      </Container>
    </AuthGuard>
  );
};
