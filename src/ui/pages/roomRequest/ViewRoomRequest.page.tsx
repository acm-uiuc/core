import React, { useEffect, useState } from 'react';
import { Container, Title, Tabs, GridCol, Grid, Timeline, Text, Tooltip } from '@mantine/core';
import { AuthGuard } from '@ui/components/AuthGuard';
import { AppRoles } from '@common/roles';
import { useApi } from '@ui/util/api';
import ExistingRoomRequests from './ExistingRoomRequests';
import NewRoomRequest from './NewRoomRequest';
import {
  RoomRequestFormValues,
  RoomRequestGetResponse,
  RoomRequestStatus,
} from '@common/types/roomRequest';
import { useParams } from 'react-router-dom';
import { IconGitBranch } from '@tabler/icons-react';
import { capitalizeFirstLetter } from '../events/ManageEvent.page';
import { formatStatus, getStatusIcon } from './roomRequestUtils';
import moment from 'moment-timezone';

export const ViewRoomRequest: React.FC = () => {
  const { semesterId, requestId } = useParams();
  const [data, setData] = useState<RoomRequestGetResponse | null>(null);
  const api = useApi('core');
  useEffect(() => {
    const thing = async () => {
      const response = await api.get(`/api/v1/roomRequests/${semesterId}/${requestId}`);
      setData(response.data);
    };
    thing();
  }, []);
  return (
    <AuthGuard
      resourceDef={{
        service: 'core',
        validRoles: [AppRoles.ROOM_REQUEST_CREATE, AppRoles.ROOM_REQUEST_UPDATE],
      }}
      showSidebar={true}
    >
      <Container mb="xl" ml="xl">
        <Title>View Room Request</Title>
      </Container>
      <Grid ml={'xl'}>
        <Grid.Col span={8}>
          {data && <NewRoomRequest viewOnly initialValues={data?.data} />}
        </Grid.Col>
        <Grid.Col span={3} ml={'lg'}>
          {data && (
            <>
              <Timeline active={data.updates.length} bulletSize={28} lineWidth={4}>
                {data.updates.map((x) => (
                  <Timeline.Item bullet={getStatusIcon(x.status)} title={formatStatus(x.status)}>
                    {x.createdBy && <Text size="xs">{x.createdBy}</Text>}
                    {x.notes && (
                      <Text c="dimmed" size="sm">
                        {x.notes}
                      </Text>
                    )}
                    {x.createdAt && (
                      <Tooltip
                        label={moment
                          .tz(x.createdAt, 'America/Chicago')
                          .format('MMMM Do YYYY, h:mm:ss a')}
                        position="top"
                        withArrow
                      >
                        <Text c="dimmed" size="xs">
                          {moment.tz(x.createdAt, 'America/Chicago').fromNow()}
                        </Text>
                      </Tooltip>
                    )}
                  </Timeline.Item>
                ))}
              </Timeline>
              <Text mt="md" size="sm" c="dimmed">
                All times in the America/Chicago timezone.
              </Text>
            </>
          )}
          <AuthGuard
            resourceDef={{
              service: 'core',
              validRoles: [AppRoles.ROOM_REQUEST_UPDATE],
            }}
            showSidebar={true}
          >
            Status update ability coming soon! {/** TODO */}
          </AuthGuard>
        </Grid.Col>
      </Grid>
    </AuthGuard>
  );
};
