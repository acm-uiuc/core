import React from 'react';
import { Container, Title, Text } from '@mantine/core';
import { AuthGuard } from '@ui/components/AuthGuard';
import { AppRoles } from '@common/roles';
import { Modules } from '@common/modules';
import { useApi } from '@ui/util/api';
import { LogRenderer } from './LogRenderer'; // Adjust import path as needed

export const ViewLogsPage: React.FC = () => {
  const api = useApi('core');

  const getLogs = async (
    service: Modules,
    start: number,
    end: number
  ): Promise<Record<string, any>[]> => {
    const response = await api.get(`/api/v1/logs/${service}?start=${start}&end=${end}`);
    return response.data;
  };

  return (
    <AuthGuard
      resourceDef={{ service: 'core', validRoles: [AppRoles.AUDIT_LOG_VIEWER] }}
      showSidebar={true}
    >
      <Container size="xl" py="md">
        <Title mb="xs">Audit Logs</Title>
        <Text mb="lg" color="dimmed">
          View system activity logs across different services
        </Text>

        <LogRenderer getLogs={getLogs} />
      </Container>
    </AuthGuard>
  );
};
