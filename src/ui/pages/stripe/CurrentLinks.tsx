import {
  Badge,
  Button,
  Checkbox,
  CopyButton,
  Group,
  Loader,
  NumberFormatter,
  Skeleton,
  Table,
  Title,
} from '@mantine/core';
import { IconAlertCircle, IconAlertTriangle } from '@tabler/icons-react';
import React, { useEffect, useState } from 'react';
import { GetInvoiceLinksResponse } from '@common/types/stripe';
import { notifications } from '@mantine/notifications';
import { useAuth } from '@ui/components/AuthContext';
import pluralize from 'pluralize';

interface StripeCurrentLinksPanelProps {
  getLinks: () => Promise<GetInvoiceLinksResponse>;
}

export const StripeCurrentLinksPanel: React.FC<StripeCurrentLinksPanelProps> = ({ getLinks }) => {
  const [links, setLinks] = useState<GetInvoiceLinksResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const { userData } = useAuth();
  useEffect(() => {
    const getLinksOnLoad = async () => {
      try {
        setIsLoading(true);
        const data = await getLinks();
        setLinks(data);
        setIsLoading(false);
      } catch (e) {
        setIsLoading(false);
        notifications.show({
          title: 'Error',
          message: 'Failed to get payment links. Please try again or contact support.',
          color: 'red',
          icon: <IconAlertCircle size={16} />,
        });
        console.error(e);
      }
    };
    getLinksOnLoad();
  }, []);
  const createTableRow = (data: GetInvoiceLinksResponse[number]) => {
    return (
      <Table.Tr
        key={data.id}
        bg={selectedRows.includes(data.id) ? 'var(--mantine-color-blue-light)' : undefined}
      >
        <Table.Td>
          <Checkbox
            aria-label="Select row"
            checked={selectedRows.includes(data.id)}
            onChange={(event) =>
              setSelectedRows(
                event.currentTarget.checked
                  ? [...selectedRows, data.id]
                  : selectedRows.filter((id) => id !== data.id)
              )
            }
          />
        </Table.Td>
        <Table.Td>
          {data.active && (
            <Badge color="green" variant="light">
              Active
            </Badge>
          )}
          {!data.active && (
            <Badge color="red" variant="light">
              Inactive
            </Badge>
          )}
        </Table.Td>
        <Table.Td>{data.invoiceId}</Table.Td>
        <Table.Td>
          <NumberFormatter prefix="$" value={data.invoiceAmountUsd / 100} thousandSeparator />
        </Table.Td>
        <Table.Td>{data.userId.replace(userData!.email!, 'You')}</Table.Td>
        <Table.Td>{data.createdAt === null ? 'Unknown' : data.createdAt}</Table.Td>
        <Table.Td>
          <CopyButton value={data.link}>
            {({ copied, copy }) => (
              <Button color={copied ? 'teal' : 'blue'} onClick={copy}>
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            )}
          </CopyButton>
        </Table.Td>
      </Table.Tr>
    );
  };
  const deactivateLinks = (linkIds: string[]) => {
    notifications.show({
      title: 'Feature not available',
      message: 'Coming soon!',
      color: 'yellow',
      icon: <IconAlertTriangle size={16} />,
    });
  };

  return (
    <div>
      <Group justify="space-between">
        <Title order={2} mb="sm">
          Current Links
        </Title>
        {selectedRows.length > 0 && (
          <Button
            color="red"
            onClick={() => {
              deactivateLinks(selectedRows);
            }}
          >
            Deactivate {pluralize('links', selectedRows.length, true)}
          </Button>
        )}
      </Group>

      <Table.ScrollContainer minWidth={500}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>
                <Checkbox
                  aria-label="Select all rows"
                  checked={links ? selectedRows.length === links.length : false}
                  onChange={(event) =>
                    setSelectedRows(() => {
                      if (!links) {
                        return [];
                      }
                      if (selectedRows.length === links.length) {
                        return [];
                      }
                      return links.map((x) => x.id);
                    })
                  }
                />
              </Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Invoice ID</Table.Th>
              <Table.Th>Invoice Amount</Table.Th>
              <Table.Th>Created By</Table.Th>
              <Table.Th>Created At</Table.Th>
              <Table.Th>Payment Link</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {isLoading || !links ? (
              <>
                <Table.Tr key="skeleton">
                  <Table.Td>
                    <Checkbox aria-label="Select row" checked={false} />
                  </Table.Td>
                  <Table.Td>
                    <Skeleton visible>
                      <Badge color="green" variant="light">
                        Active
                      </Badge>
                    </Skeleton>
                  </Table.Td>
                  <Table.Td>
                    <Skeleton visible>Sample Text</Skeleton>
                  </Table.Td>
                  <Table.Td>
                    <Skeleton visible>Sample Text</Skeleton>
                  </Table.Td>
                  <Table.Td>
                    <Skeleton visible>Sample Text</Skeleton>
                  </Table.Td>
                  <Table.Td>
                    <Skeleton visible>Sample Text</Skeleton>
                  </Table.Td>
                  <Table.Td>
                    <Skeleton visible>
                      {' '}
                      <CopyButton value={''}>
                        {({ copied, copy }) => (
                          <Button color={copied ? 'teal' : 'blue'} onClick={copy}>
                            {copied ? 'Copied!' : 'Copy'}
                          </Button>
                        )}
                      </CopyButton>
                    </Skeleton>
                  </Table.Td>
                </Table.Tr>
              </>
            ) : (
              links.map(createTableRow)
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </div>
  );
};

export default StripeCurrentLinksPanel;
