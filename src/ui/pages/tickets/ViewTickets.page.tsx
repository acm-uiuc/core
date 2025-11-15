import {
  Table,
  Text,
  Group,
  Pagination,
  Select,
  Badge,
  Title,
  Button,
  Modal,
  Stack,
  TextInput,
  Alert,
  Tooltip,
  Box,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import pluralize from "pluralize";
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import * as z from "zod/v4";

import FullScreenLoader from "@ui/components/AuthContext/LoadingScreen";
import { AuthGuard } from "@ui/components/AuthGuard";
import { useApi } from "@ui/util/api";
import { AppRoles } from "@common/roles";
import { NameOptionalUserCard } from "@ui/components/NameOptionalCard";

// Define the schemas
const purchaseSchema = z.object({
  email: z.string().email(),
  productId: z.string(),
  quantity: z.number().int().positive(),
  size: z.string().optional(),
});

const ticketEntrySchema = z.object({
  valid: z.boolean(),
  type: z.enum(["merch", "ticket"]),
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
  ticket: TicketEntry,
): { status: "fulfilled" | "unfulfilled" | "refunded"; color: string } => {
  if (ticket.refunded) {
    return { status: "refunded", color: "red" };
  }
  if (ticket.fulfilled) {
    return { status: "fulfilled", color: "green" };
  }
  return { status: "unfulfilled", color: "orange" };
};

enum TicketsCopyMode {
  ALL,
  FULFILLED,
  UNFULFILLED,
}
const WAIT_BEFORE_FULFILLING_SECS = 15;

const ViewTicketsPage: React.FC = () => {
  const { eventId } = useParams();
  const [allTickets, setAllTickets] = useState<TicketEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const api = useApi("core");

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [totalQuantitySold, setTotalQuantitySold] = useState(0);
  const [pageSize, setPageSize] = useState<string>("10");
  const pageSizeOptions = ["10", "25", "50", "100"];

  // Confirmation modal states
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [ticketToFulfill, setTicketToFulfill] = useState<TicketEntry | null>(
    null,
  );
  const [confirmError, setConfirmError] = useState("");
  const [confirmButtonEnabled, setConfirmButtonEnabled] = useState(false);
  const [countdown, setCountdown] = useState(3);

  // Email copy confirmation modal states
  const [showCopyEmailModal, setShowCopyEmailModal] = useState(false);
  const [pendingCopyMode, setPendingCopyMode] =
    useState<TicketsCopyMode | null>(null);

  useEffect(() => {
    if (showConfirmModal) {
      setConfirmButtonEnabled(false);
      setCountdown(WAIT_BEFORE_FULFILLING_SECS);

      const handleVisibilityChange = () => {
        if (document.hidden) {
          // Reset the timer when user leaves the page
          setCountdown(WAIT_BEFORE_FULFILLING_SECS + 1);
          setConfirmButtonEnabled(false);
        }
      };

      document.addEventListener("visibilitychange", handleVisibilityChange);

      const countdownInterval = setInterval(() => {
        // Only count down if the page is focused
        if (document.hidden) {
          return;
        }

        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(countdownInterval);
            setConfirmButtonEnabled(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => {
        clearInterval(countdownInterval);
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      };
    }
  }, [showConfirmModal]);

  const handleCopyEmailsClick = (mode: TicketsCopyMode) => {
    setPendingCopyMode(mode);
    setShowCopyEmailModal(true);
  };

  const handleCloseCopyEmailModal = () => {
    setShowCopyEmailModal(false);
    setPendingCopyMode(null);
  };

  const handleConfirmCopyEmails = () => {
    if (pendingCopyMode === null) {
      return;
    }
    copyEmails(pendingCopyMode);
    handleCloseCopyEmailModal();
  };

  const copyEmails = (mode: TicketsCopyMode) => {
    try {
      let emailsToCopy: string[] = [];
      let copyModeHumanString = "";
      const nonRefundedTickets = allTickets.filter((x) => !x.refunded);
      switch (mode) {
        case TicketsCopyMode.ALL:
          emailsToCopy = nonRefundedTickets.map((x) => x.purchaserData.email);
          copyModeHumanString = "All";
          break;
        case TicketsCopyMode.FULFILLED:
          emailsToCopy = nonRefundedTickets
            .filter((x) => x.fulfilled)
            .map((x) => x.purchaserData.email);
          copyModeHumanString = "Fulfilled";
          break;
        case TicketsCopyMode.UNFULFILLED:
          emailsToCopy = nonRefundedTickets
            .filter((x) => !x.fulfilled)
            .map((x) => x.purchaserData.email);
          copyModeHumanString = "Unfulfilled";
          break;
      }
      emailsToCopy = [...new Set(emailsToCopy)];
      navigator.clipboard.writeText(emailsToCopy.join(";"));
      notifications.show({
        message: `${copyModeHumanString} emails copied!`,
      });
    } catch (e) {
      notifications.show({
        title: "Failed to copy emails",
        message: "Please try again or contact support.",
        color: "red",
      });
    }
  };

  const handleOpenConfirmModal = (ticket: TicketEntry) => {
    setTicketToFulfill(ticket);
    setConfirmEmail("");
    setConfirmError("");
    setShowConfirmModal(true);
  };

  const handleCloseConfirmModal = () => {
    setShowConfirmModal(false);
    setTicketToFulfill(null);
    setConfirmEmail("");
    setConfirmError("");
    setConfirmButtonEnabled(false);
    setCountdown(WAIT_BEFORE_FULFILLING_SECS);
  };

  const handleConfirmFulfillment = async () => {
    if (!ticketToFulfill) {
      return;
    }

    // Validate email matches
    if (
      confirmEmail.toLowerCase().trim() !==
      ticketToFulfill.purchaserData.email.toLowerCase().trim()
    ) {
      setConfirmError(
        "Email does not match. Please enter the exact email address.",
      );
      return;
    }

    try {
      const response = await api.post(
        `/api/v1/tickets/checkIn`,
        {
          type: ticketToFulfill.type,
          email: ticketToFulfill.purchaserData.email,
          stripePi: ticketToFulfill.ticketId,
        },
        {
          headers: {
            "x-auditlog-context": "Manually marked as fulfilled.",
          },
        },
      );
      if (!response.data.valid) {
        throw new Error("Ticket is invalid.");
      }
      notifications.show({
        title: "Fulfilled",
        message: "Marked item as fulfilled. This action has been logged.",
      });
      handleCloseConfirmModal();
      await getTickets();
    } catch {
      notifications.show({
        title: "Error marking as fulfilled",
        message: "Failed to fulfill item. Please try again later.",
        color: "red",
      });
      handleCloseConfirmModal();
    }
  };

  async function checkInUser(ticket: TicketEntry) {
    handleOpenConfirmModal(ticket);
  }
  const getTickets = async () => {
    try {
      setLoading(true);
      const response = await api.get(
        `/api/v1/tickets/event/${eventId}?type=merch`,
      );
      const parsedResponse = ticketsResponseSchema.parse(response.data);
      let localQuantitySold = 0;
      for (const item of parsedResponse.tickets) {
        localQuantitySold += item.purchaserData.quantity;
      }
      setTotalQuantitySold(localQuantitySold);
      setAllTickets(parsedResponse.tickets);
    } catch (error) {
      console.error("Error fetching tickets:", error);
      notifications.show({
        title: "Error fetching tickets",
        message: "Failed to load tickets. Please try again later.",
        color: "red",
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
  const totalPages = Math.ceil(totalItems / parseInt(pageSize, 10));
  const startIndex = (currentPage - 1) * parseInt(pageSize, 10);
  const endIndex = startIndex + parseInt(pageSize, 10);
  const currentTickets = allTickets.slice(startIndex, endIndex);
  const copyTicketId = (ticketId: string) => {
    try {
      navigator.clipboard.writeText(ticketId);
      notifications.show({
        message: "Ticket ID copied!",
      });
    } catch (e) {
      notifications.show({
        title: "Failed to copy ticket ID",
        message: "Please try again or contact support.",
        color: "red",
      });
    }
  };
  return (
    <AuthGuard
      resourceDef={{ service: "core", validRoles: [AppRoles.TICKETS_MANAGER] }}
    >
      <Title order={2}>View Tickets/Merch Sales</Title>
      <Group mt="md">
        <Button
          onClick={() => {
            handleCopyEmailsClick(TicketsCopyMode.ALL);
          }}
        >
          Copy All Emails
        </Button>
        <Button
          onClick={() => {
            handleCopyEmailsClick(TicketsCopyMode.FULFILLED);
          }}
        >
          Copy Fulfilled Emails
        </Button>
        <Button
          onClick={() => {
            handleCopyEmailsClick(TicketsCopyMode.UNFULFILLED);
          }}
        >
          Copy Unfulfilled Emails
        </Button>
      </Group>
      <Text size="xs">Note: all lists do not include refunded tickets.</Text>
      <div>
        <Title mt="md" order={4}>
          {pluralize("item", totalQuantitySold, true)} sold
        </Title>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Email</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Quantity</Table.Th>
              <Table.Th>Size</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {currentTickets.map((ticket) => {
              const { status, color } = getTicketStatus(ticket);
              return (
                <Table.Tr key={ticket.ticketId}>
                  <Table.Td>
                    <Tooltip
                      label="Click to copy ticket ID"
                      position="top"
                      withArrow
                    >
                      <Box
                        style={{ cursor: "pointer" }}
                        onClick={() => copyTicketId(ticket.ticketId)}
                      >
                        <NameOptionalUserCard
                          email={ticket.purchaserData.email}
                          size="sm"
                        />
                      </Box>
                    </Tooltip>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={color}>{status}</Badge>
                  </Table.Td>
                  <Table.Td>{ticket.purchaserData.quantity}</Table.Td>
                  <Table.Td>{ticket.purchaserData.size || "N/A"}</Table.Td>
                  <Table.Td>
                    {!(ticket.fulfilled || ticket.refunded) && (
                      <AuthGuard
                        resourceDef={{
                          service: "core",
                          validRoles: [AppRoles.TICKETS_SCANNER],
                        }}
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
                setPageSize(value || "10");
                setCurrentPage(1); // Reset to first page when changing page size
              }}
              data={pageSizeOptions}
              style={{ width: 80 }}
            />

            <Text size="sm">
              Showing {startIndex + 1} to {Math.min(endIndex, totalItems)} of{" "}
              {pluralize("entry", totalItems, true)}
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

      {/* Confirmation Modal */}
      <Modal
        opened={showConfirmModal}
        onClose={handleCloseConfirmModal}
        title="Confirm Fulfillment"
        size="md"
        centered
      >
        <Stack>
          <Alert
            icon={<IconAlertCircle size={16} />}
            title="Warning"
            color="red"
            variant="light"
          >
            <Text size="sm" fw={500}>
              This action cannot be undone and will be logged!
            </Text>
          </Alert>

          {ticketToFulfill && (
            <>
              <Text size="sm" fw={600}>
                Purchase Details:
              </Text>
              <Text size="sm">
                <strong>Email:</strong> {ticketToFulfill.purchaserData.email}
              </Text>
              <Text size="sm">
                <strong>Quantity:</strong>{" "}
                {ticketToFulfill.purchaserData.quantity}
              </Text>
              {ticketToFulfill.purchaserData.size && (
                <Text size="sm">
                  <strong>Size:</strong> {ticketToFulfill.purchaserData.size}
                </Text>
              )}
            </>
          )}

          <TextInput
            label="Confirm Email Address"
            placeholder="Enter the email address to confirm"
            value={confirmEmail}
            onChange={(e) => {
              setConfirmEmail(e.currentTarget.value);
              setConfirmError("");
            }}
            error={confirmError}
            required
            autoComplete="off"
            data-autofocus
          />

          <Text size="xs" c="dimmed">
            Please enter the email address{" "}
            <strong>{ticketToFulfill?.purchaserData.email}</strong> to confirm
            that you want to mark this purchase as fulfilled.
          </Text>

          <Group justify="flex-end" mt="md">
            <Button variant="subtle" onClick={handleCloseConfirmModal}>
              Cancel
            </Button>
            <Button
              color="blue"
              onClick={handleConfirmFulfillment}
              disabled={!confirmEmail.trim() || !confirmButtonEnabled}
            >
              {!confirmButtonEnabled
                ? `Wait ${countdown}s to confirm...`
                : "Confirm Fulfillment"}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Copy Emails Confirmation Modal */}
      <Modal
        opened={showCopyEmailModal}
        onClose={handleCloseCopyEmailModal}
        title="Copy Emails"
        size="md"
        centered
      >
        <Stack>
          <Alert
            icon={<IconAlertCircle size={16} />}
            title="Privacy Notice"
            color="yellow"
            variant="light"
          >
            <Text size="sm" fw={500}>
              Be sure to BCC all recipients to avoid leaking the purchase list
            </Text>
          </Alert>

          <Text size="sm">
            When composing your email, make sure to add all email addresses to
            the BCC field (not To or CC) to protect the privacy of your
            recipients.
          </Text>

          <Group justify="flex-end" mt="md">
            <Button color="blue" onClick={handleConfirmCopyEmails}>
              I understand, copy emails
            </Button>
          </Group>
        </Stack>
      </Modal>
    </AuthGuard>
  );
};

export { ViewTicketsPage };
