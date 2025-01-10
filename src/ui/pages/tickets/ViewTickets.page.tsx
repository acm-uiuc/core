import { Table, Text, Group, Pagination, Select, Badge, Title, Button } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import pluralize from 'pluralize';
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { z } from 'zod';

import FullScreenLoader from '@ui/components/AuthContext/LoadingScreen';
import { AuthGuard } from '@ui/components/AuthGuard';
import { useApi } from '@ui/util/api';
import { AppRoles } from '@common/roles';

// Define the schemas
const purchaseSchema = z.object({
  email: z.string().email(),
  productId: z.string(),
  quantity: z.number().int().positive(),
  size: z.string().optional(),
});

const ticketEntrySchema = z.object({
  valid: z.boolean(),
  type: z.enum(['merch', 'ticket']),
  ticketId: z.string().min(1),
  refunded: z.boolean(),
  fulfilled: z.boolean(),
  purchaserData: purchaseSchema,
});

const ticketsResponseSchema = z.object({
  tickets: z.array(ticketEntrySchema),
});

type TicketEntry = z.infer<typeof ticketEntrySchema>;

const getTicketStatus = (
  ticket: TicketEntry
): { status: 'fulfilled' | 'unfulfilled' | 'refunded'; color: string } => {
  if (ticket.refunded) {
    return { status: 'refunded', color: 'red' };
  }
  if (ticket.fulfilled) {
    return { status: 'fulfilled', color: 'green' };
  }
  return { status: 'unfulfilled', color: 'orange' };
};

const ViewTicketsPage: React.FC = () => {
  const { eventId } = useParams();
  const [allTickets, setAllTickets] = useState<TicketEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const api = useApi('core');

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [totalQuantitySold, setTotalQuantitySold] = useState(0);
  const [pageSize, setPageSize] = useState<string>('10');
  const pageSizeOptions = ['10', '25', '50', '100'];

  async function checkInUser(ticket: TicketEntry) {
    try {
      const response = await api.post(`/api/v1/tickets/checkIn`, {
        type: ticket['type'],
        email: ticket['purchaserData']['email'],
        stripePi: ticket['ticketId'],
      });
      if (!response.data.valid) {
        throw new Error('Ticket is invalid.');
      }
      notifications.show({
        title: 'Fulfilled',
        message: 'Marked item as fulfilled.',
      });
      await getTickets();
    } catch {
      notifications.show({
        title: 'Error marking as fulfilled',
        message: 'Failed to fulfill item. Please try again later.',
        color: 'red',
      });
    }
  }
  const getTickets = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/api/v1/tickets/${eventId}?type=merch`);
      const parsedResponse = ticketsResponseSchema.parse(response.data);
      let localQuantitySold = 0;
      for (const item of parsedResponse.tickets) {
        localQuantitySold += item.purchaserData.quantity;
      }
      setTotalQuantitySold(localQuantitySold);
      setAllTickets(parsedResponse.tickets);
    } catch (error) {
      console.error('Error fetching tickets:', error);
      notifications.show({
        title: 'Error fetching tickets',
        message: 'Failed to load tickets. Please try again later.',
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    getTickets();
  }, [eventId]);

  if (loading) {
    return <FullScreenLoader />;
  }

  // Calculate pagination
  const totalItems = allTickets.length;
  const totalPages = Math.ceil(totalItems / parseInt(pageSize));
  const startIndex = (currentPage - 1) * parseInt(pageSize);
  const endIndex = startIndex + parseInt(pageSize);
  const currentTickets = allTickets.slice(startIndex, endIndex);
  return (
    <AuthGuard resourceDef={{ service: 'core', validRoles: [AppRoles.TICKETS_MANAGER] }}>
      <Title order={2}>View Tickets/Merch Sales</Title>
      <div>
        <br />
        <Title order={4}>{pluralize('item', totalQuantitySold, true)} sold</Title>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Email</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Quantity</Table.Th>
              <Table.Th>Size</Table.Th>
              <Table.Th>Ticket ID</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {currentTickets.map((ticket) => {
              const { status, color } = getTicketStatus(ticket);
              return (
                <Table.Tr key={ticket.ticketId}>
                  <Table.Td>{ticket.purchaserData.email}</Table.Td>
                  <Table.Td>
                    <Badge color={color}>{status}</Badge>
                  </Table.Td>
                  <Table.Td>{ticket.purchaserData.quantity}</Table.Td>
                  <Table.Td>{ticket.purchaserData.size || 'N/A'}</Table.Td>
                  <Table.Td>{ticket.ticketId}</Table.Td>
                  <Table.Td>
                    {!(ticket.fulfilled || ticket.refunded) && (
                      <AuthGuard
                        resourceDef={{ service: 'core', validRoles: [AppRoles.TICKETS_SCANNER] }}
                        isAppShell={false}
                      >
                        <Button
                          variant="outline"
                          onClick={() => checkInUser(ticket)}
                          id={`${ticket.ticketId}-manual-checkin`}
                          data-testid={`${ticket.ticketId}-manual-checkin`}
                        >
                          Mark as Fulfilled
                        </Button>
                      </AuthGuard>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>

        {/* Pagination Controls */}
        <Group justify="space-between" mt="md">
          <Group>
            <Text size="sm">Items per page:</Text>
            <Select
              value={pageSize}
              onChange={(value) => {
                setPageSize(value || '10');
                setCurrentPage(1); // Reset to first page when changing page size
              }}
              data={pageSizeOptions}
              style={{ width: 80 }}
            />
            <Text size="sm">
              Showing {startIndex + 1} to {Math.min(endIndex, totalItems)} of{' '}
              {pluralize('entry', totalItems, true)}
            </Text>
          </Group>
          <Pagination
            value={currentPage}
            onChange={setCurrentPage}
            total={totalPages}
            siblings={1}
            boundaries={1}
          />
        </Group>
      </div>
    </AuthGuard>
  );
};

export { ViewTicketsPage };
