import React, { useState } from 'react';
import { Card, Container, Divider, Title, Text } from '@mantine/core';
import { AuthGuard } from '@ui/components/AuthGuard';
import { AppRoles } from '@common/roles';
import {
  GetInvoiceLinksResponse,
  PostInvoiceLinkRequest,
  PostInvoiceLinkResponse,
} from '@common/types/stripe';
import { useApi } from '@ui/util/api';

export const ManageRoomRequestsPage: React.FC = () => {
  const api = useApi('core');

  const getLinks = async (semester: string): Promise<GetInvoiceLinksResponse> => {
    const response = await api.get(`/api/v1/roomRequests/${semester}`);
    return response.data;
  };

  return (
    <AuthGuard
      resourceDef={{
        service: 'core',
        validRoles: [AppRoles.ROOM_REQUEST_CREATE, AppRoles.ROOM_REQUEST_UPDATE],
      }}
      showSidebar={true}
    >
      <Container>
        <Title>Room Requests</Title>
        Coming soon!
      </Container>
    </AuthGuard>
  );
};
