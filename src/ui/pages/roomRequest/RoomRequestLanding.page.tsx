import React, { useState } from 'react';
import { Container, Title, Tabs } from '@mantine/core';
import { AuthGuard } from '@ui/components/AuthGuard';
import { AppRoles } from '@common/roles';
import { useApi } from '@ui/util/api';
import ExistingRoomRequests from './ExistingRoomRequests';
import NewRoomRequest from './NewRoomRequest';
import {
  RoomRequestFormValues,
  RoomRequestGetAllResponse,
  RoomRequestPostResponse,
} from '@common/types/roomRequest';

export const ManageRoomRequestsPage: React.FC = () => {
  const api = useApi('core');
  const [semester, setSemester] = useState<string>('sp25');

  const createRoomRequest = async (
    payload: RoomRequestFormValues
  ): Promise<RoomRequestPostResponse> => {
    const response = await api.post(`/api/v1/roomRequests/`, payload);
    return response.data;
  };

  const getRoomRequests = async (semester: string): Promise<RoomRequestGetAllResponse> => {
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
        <Tabs variant="pills" defaultValue="existing_requests">
          <Tabs.List>
            <Tabs.Tab value="existing_requests">Existing Requests</Tabs.Tab>
            <Tabs.Tab value="new_requests">New Request</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="existing_requests">
            <br />
            <ExistingRoomRequests getRoomRequests={getRoomRequests} semester={semester} />
          </Tabs.Panel>

          <Tabs.Panel value="new_requests">
            <br />
            <NewRoomRequest createRoomRequest={createRoomRequest} />
          </Tabs.Panel>
        </Tabs>
      </Container>
    </AuthGuard>
  );
};
