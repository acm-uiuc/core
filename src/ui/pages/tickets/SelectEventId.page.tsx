import { Text, Group, Title, Badge, Card, Button } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as z from "zod/v4";

import FullScreenLoader from "@ui/components/AuthContext/LoadingScreen";
import { AuthGuard } from "@ui/components/AuthGuard";
import { useApi } from "@ui/util/api";
import { AppRoles } from "@common/roles";
import { ItemPostData } from "@common/types/tickets";
import {
  ResponsiveTable,
  Column,
  useTableSort,
} from "@ui/components/ResponsiveTable";

const baseItemMetadata = z.object({
  itemId: z.string().min(1),
  itemName: z.string().min(1),
  itemSalesActive: z.union([
    z.string().transform((str) => new Date(str)),
    z.literal(false),
  ]),
  priceDollars: z.object({
    member: z.number().min(0),
    nonMember: z.number().min(0),
  }),
});

const ticketingItemMetadata = baseItemMetadata.extend({
  eventCapacity: z.number(),
  ticketsSold: z.number(),
});

type ItemMetadata = z.infer<typeof baseItemMetadata>;
type TicketItemMetadata = z.infer<typeof ticketingItemMetadata>;

const listItemsResponseSchema = z.object({
  merch: z.array(baseItemMetadata),
  tickets: z.array(ticketingItemMetadata),
});

const getTicketStatus = (item: TicketItemMetadata) => {
  if (item.itemSalesActive === false) {
    return { text: "Not Open", color: "gray" as const };
  }
  if (item.ticketsSold >= item.eventCapacity) {
    return { text: "Sold Out", color: "red" as const };
  }
  if (
    typeof item.itemSalesActive === "object" &&
    item.itemSalesActive > new Date()
  ) {
    return { text: "Coming Soon", color: "yellow" as const };
  }
  return { text: "Active", color: "green" as const };
};

const getMerchStatus = (item: ItemMetadata) => {
  if (item.itemSalesActive === false) {
    return { text: "Not Available", color: "gray" as const };
  }
  if (
    typeof item.itemSalesActive === "object" &&
    item.itemSalesActive > new Date()
  ) {
    return { text: "Coming Soon", color: "yellow" as const };
  }
  return { text: "Available", color: "green" as const };
};

const SelectTicketsPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<{
    tickets: TicketItemMetadata[];
    merch: ItemMetadata[];
  }>({ tickets: [], merch: [] });

  const { sortBy, reversedSort, handleSort, sortData } = useTableSort<
    ItemMetadata | TicketItemMetadata
  >("status");

  const api = useApi("core");
  const navigate = useNavigate();

  const isTicketItem = (
    item: ItemMetadata | TicketItemMetadata,
  ): item is TicketItemMetadata => {
    return "eventCapacity" in item && "ticketsSold" in item;
  };

  const fetchItems = async () => {
    try {
      setLoading(true);
      const response = await api.get("/api/v1/tickets");
      const parsed = listItemsResponseSchema.parse(response.data);
      setItems({
        tickets: parsed.tickets,
        merch: parsed.merch,
      });
    } catch (error) {
      console.error("Error fetching items:", error);
      notifications.show({
        title: "Error fetching items",
        message: "Failed to load available items. Please try again later.",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const handleToggleSales = async (item: ItemMetadata | TicketItemMetadata) => {
    let newIsActive = false;
    if (isTicketItem(item)) {
      newIsActive = !(getTicketStatus(item).color === "green");
    } else {
      newIsActive = !(getMerchStatus(item).color === "green");
    }

    try {
      setLoading(true);
      const data: ItemPostData = {
        itemSalesActive: newIsActive,
        type: isTicketItem(item) ? "ticket" : "merch",
      };
      await api.patch(`/api/v1/tickets/event/${item.itemId}`, data);
      await fetchItems();
      notifications.show({
        title: "Changes saved",
        message: `Sales for ${item.itemName} are ${newIsActive ? "enabled" : "disabled"}!`,
      });
    } catch (error) {
      console.error("Error setting new status:", error);
      notifications.show({
        title: "Error setting status",
        message: "Failed to set status. Please try again later.",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleManageClick = (itemId: string) => {
    navigate(`/tickets/manage/${itemId}`);
  };

  const handleScanClick = () => {
    navigate(`/tickets/scan`);
  };

  // Sort function for both merch and tickets
  const sortFn = (
    a: ItemMetadata | TicketItemMetadata,
    b: ItemMetadata | TicketItemMetadata,
    sortBy: string,
  ) => {
    if (sortBy === "name") {
      return a.itemName.localeCompare(b.itemName);
    }
    if (sortBy === "status") {
      const statusA = isTicketItem(a)
        ? getTicketStatus(a).text
        : getMerchStatus(a).text;
      const statusB = isTicketItem(b)
        ? getTicketStatus(b).text
        : getMerchStatus(b).text;
      return statusA.localeCompare(statusB);
    }
    return 0;
  };

  // Define columns for merchandise
  const merchColumns: Column<ItemMetadata>[] = [
    {
      key: "name",
      label: "Item Name",
      isPrimaryColumn: true,
      sortable: true,
      render: (item) => item.itemName,
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (item) => {
        const status = getMerchStatus(item);
        return <Badge color={status.color}>{status.text}</Badge>;
      },
    },
    {
      key: "price",
      label: "Price (Member / Non-Member)",
      render: (item) => (
        <>
          ${item.priceDollars.member.toFixed(2)} / $
          {item.priceDollars.nonMember.toFixed(2)}
        </>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      hideMobileLabel: true,
      render: (item) => (
        <Group>
          <AuthGuard
            isAppShell={false}
            resourceDef={{
              service: "core",
              validRoles: [AppRoles.TICKETS_MANAGER],
            }}
          >
            <Button
              variant="primary"
              onClick={(e) => {
                e.stopPropagation();
                handleManageClick(item.itemId);
              }}
              id={`merch-${item.itemId}-manage`}
            >
              View Sales
            </Button>
            <Button
              color={getMerchStatus(item).color === "green" ? "red" : "green"}
              onClick={(e) => {
                e.stopPropagation();
                handleToggleSales(item);
              }}
              id={`tickets-${item.itemId}-toggle-status`}
            >
              {getMerchStatus(item).color === "green" ? "Disable" : "Enable"}{" "}
              Sales
            </Button>
          </AuthGuard>
        </Group>
      ),
    },
  ];

  // Define columns for tickets
  const ticketColumns: Column<TicketItemMetadata>[] = [
    {
      key: "name",
      label: "Event Name",
      isPrimaryColumn: true,
      sortable: true,
      render: (ticket) => ticket.itemName,
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (ticket) => {
        const status = getTicketStatus(ticket);
        return <Badge color={status.color}>{status.text}</Badge>;
      },
    },
    {
      key: "capacity",
      label: "Capacity",
      render: (ticket) => (
        <Group gap="xs">
          <Text>
            {ticket.ticketsSold}/{ticket.eventCapacity}
          </Text>
          {ticket.ticketsSold >= ticket.eventCapacity && (
            <Badge color="red" size="sm">
              Full
            </Badge>
          )}
        </Group>
      ),
    },
    {
      key: "price",
      label: "Price (Member/Non-Member)",
      mobileLabel: "Price",
      render: (ticket) => (
        <>
          ${ticket.priceDollars.member.toFixed(2)} / $
          {ticket.priceDollars.nonMember.toFixed(2)}
        </>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      hideMobileLabel: true,
      render: (ticket) => (
        <Group>
          <AuthGuard
            isAppShell={false}
            resourceDef={{
              service: "core",
              validRoles: [AppRoles.TICKETS_MANAGER],
            }}
          >
            <Button
              variant="primary"
              onClick={(e) => {
                e.stopPropagation();
                handleManageClick(ticket.itemId);
              }}
              id={`tickets-${ticket.itemId}-manage`}
            >
              View Sales
            </Button>
            <Button
              color={
                getTicketStatus(ticket).color === "green" ? "red" : "green"
              }
              onClick={(e) => {
                e.stopPropagation();
                handleToggleSales(ticket);
              }}
              id={`tickets-${ticket.itemId}-toggle-status`}
            >
              {getTicketStatus(ticket).color === "green" ? "Disable" : "Enable"}{" "}
              Sales
            </Button>
          </AuthGuard>
        </Group>
      ),
    },
  ];

  if (loading) {
    return <FullScreenLoader />;
  }

  const sortedMerch = sortData(
    items.merch as (ItemMetadata | TicketItemMetadata)[],
    sortFn,
  ) as ItemMetadata[];
  const sortedTickets = sortData(
    items.tickets as (ItemMetadata | TicketItemMetadata)[],
    sortFn,
  ) as TicketItemMetadata[];

  return (
    <AuthGuard
      resourceDef={{
        service: "core",
        validRoles: [AppRoles.TICKETS_MANAGER, AppRoles.TICKETS_SCANNER],
      }}
    >
      <Title order={2} mb="md">
        Tickets & Merchandise
      </Title>

      <AuthGuard
        isAppShell={false}
        resourceDef={{
          service: "core",
          validRoles: [AppRoles.TICKETS_SCANNER],
        }}
      >
        <Button
          variant="primary"
          onClick={() => handleScanClick()}
          id="merch-scan"
          style={{ marginBottom: "2vh" }}
        >
          Scan Ticket/Merch Codes
        </Button>
      </AuthGuard>

      <Card withBorder mb="lg">
        <Title order={3} mb="md">
          Merchandise
        </Title>
        <ResponsiveTable
          data={sortedMerch}
          columns={merchColumns}
          keyExtractor={(item) => item.itemId}
          onSort={handleSort}
          sortBy={sortBy}
          sortReversed={reversedSort}
          testIdPrefix="merch-row"
        />
      </Card>

      <Card withBorder mb="lg">
        <Title order={3} mb="md">
          Tickets
        </Title>
        <ResponsiveTable
          data={sortedTickets}
          columns={ticketColumns}
          keyExtractor={(ticket) => ticket.itemId}
          onSort={handleSort}
          sortBy={sortBy}
          sortReversed={reversedSort}
          testIdPrefix="ticket-row"
        />
      </Card>
    </AuthGuard>
  );
};

export { SelectTicketsPage };
