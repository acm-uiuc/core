import React, { useState, useEffect } from "react";
import {
  Table,
  Group,
  Select,
  Title,
  Paper,
  Badge,
  Text,
  Button,
  Pagination,
  Loader,
  Stack,
  TextInput,
  Switch,
  Tooltip,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import {
  IconRefresh,
  IconFileText,
  IconSearch,
  IconClock,
  IconWorld,
} from "@tabler/icons-react";
import { Modules, ModulesToHumanName } from "@common/modules";
import { notifications } from "@mantine/notifications";

interface LogEntry {
  actor: string;
  createdAt: number;
  expireAt: number;
  message: string;
  module: string;
  requestId?: string;
  target: string;
}

interface LogRendererProps {
  getLogs: (
    service: Modules,
    start: number,
    end: number,
  ) => Promise<Record<string, any>[]>;
}

export const LogRenderer: React.FC<LogRendererProps> = ({ getLogs }) => {
  // State for selected time range
  const [startTime, setStartTime] = useState<Date | null>(
    new Date(Date.now() - 24 * 60 * 60 * 1000), // Default to 24 hours ago
  );
  const [endTime, setEndTime] = useState<Date | null>(new Date());

  // State for selected module
  const [selectedModule, setSelectedModule] = useState<string | null>(null);

  // State for logs and loading
  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  // State for pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<string>("10");
  const pageSizeOptions = ["10", "25", "50", "100"];

  // Search filter
  const [searchQuery, setSearchQuery] = useState("");

  // Time display preference
  const [showUtcTime, setShowUtcTime] = useState(false);

  // Convert Modules enum to array for Select component
  const moduleOptions = Object.values(Modules)
    .map((module) => ({
      value: module,
      label: ModulesToHumanName[module],
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  // Convert local date to UTC epoch timestamp (seconds, not milliseconds)
  const dateToEpochTimestamp = (date: Date): number => {
    return Math.floor(date.getTime() / 1000); // Convert milliseconds to seconds
  };

  const fetchLogs = async () => {
    if (!selectedModule || !startTime || !endTime) {
      notifications.show({
        title: "Missing parameters",
        message: "Please select a module and time range",
        color: "red",
      });
      return;
    }

    setLoading(true);
    try {
      // Convert the local dates to epoch timestamps in seconds
      const startTimestamp = dateToEpochTimestamp(startTime);
      const endTimestamp = dateToEpochTimestamp(endTime);

      const data = await getLogs(
        selectedModule as Modules,
        startTimestamp,
        endTimestamp,
      );

      setLogs(data as LogEntry[]);
      setCurrentPage(1); // Reset to first page on new data
    } catch (error) {
      console.error("Error fetching logs:", error);
      notifications.show({
        title: "Error fetching logs",
        message: "Failed to load logs. Please try again later.",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  // Filter logs based on search query
  const filteredLogs = logs
    ? logs.filter((log) => {
        if (!searchQuery.trim()) {
          return true;
        }

        const query = searchQuery.toLowerCase();
        return (
          log.actor?.toLowerCase().includes(query) ||
          log.message?.toLowerCase().includes(query) ||
          log.target?.toLowerCase().includes(query) ||
          log.requestId?.toLowerCase().includes(query)
        );
      })
    : [];

  // Calculate pagination
  const totalItems = filteredLogs.length;
  const totalPages = Math.ceil(totalItems / parseInt(pageSize, 10));
  const startIndex = (currentPage - 1) * parseInt(pageSize, 10);
  const endIndex = startIndex + parseInt(pageSize, 10);
  const currentLogs = filteredLogs.slice(startIndex, endIndex);

  // Format timestamp to readable date based on user preference
  const formatTimestamp = (timestamp: number): string => {
    // Multiply by 1000 to convert from seconds to milliseconds if needed
    const timeMs = timestamp > 10000000000 ? timestamp : timestamp * 1000;
    const date = new Date(timeMs);

    if (showUtcTime) {
      // Format in UTC time
      return date.toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
        timeZone: "UTC",
        timeZoneName: "short",
      });
    }
    // Format in local time with timezone name
    return new Date(timeMs).toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
      hour12: true,
    });
  };

  // Get relative time from now
  const getRelativeTime = (timestamp: number): string => {
    // Ensure timestamp is in milliseconds
    const timeMs = timestamp > 10000000000 ? timestamp : timestamp * 1000;
    const now = Date.now();
    const diff = now - timeMs;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days} day${days > 1 ? "s" : ""} ago`;
    }
    if (hours > 0) {
      return `${hours} hour${hours > 1 ? "s" : ""} ago`;
    }
    if (minutes > 0) {
      return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
    }
    return `${seconds} second${seconds !== 1 ? "s" : ""} ago`;
  };

  return (
    <Stack>
      <Paper p="md" radius="md" withBorder>
        <Stack>
          <Title order={3}>Filter Logs</Title>

          <Group align="flex-end">
            <Select
              label="Module"
              placeholder="Select service module"
              data={moduleOptions}
              value={selectedModule}
              onChange={setSelectedModule}
              style={{ width: 200 }}
              required
            />

            <DateTimePicker
              label="Start Time"
              placeholder="Select start time"
              value={startTime}
              onChange={setStartTime}
              style={{ width: 250 }}
              valueFormat={
                showUtcTime
                  ? "MM-DD-YYYY h:mm A [UTC]"
                  : `MM-DD-YYYY h:mm A [Local Time]`
              }
              data-testid="start-time-input"
              required
            />

            <DateTimePicker
              label="End Time"
              placeholder="Select end time"
              value={endTime}
              onChange={setEndTime}
              style={{ width: 250 }}
              valueFormat={
                showUtcTime
                  ? "MM-DD-YYYY h:mm A [UTC]"
                  : `MM-DD-YYYY h:mm A [Local Time]`
              }
              data-testid="end-time-input"
              required
            />

            <Button
              leftSection={<IconRefresh size={18} />}
              onClick={fetchLogs}
              loading={loading}
            >
              Fetch Logs
            </Button>
          </Group>

          <Group>
            <Tooltip
              label={
                showUtcTime ? "Switch to local time" : "Switch to UTC time"
              }
            >
              <Switch
                label={
                  <Group m="xs">
                    <IconWorld size={16} />
                    <Text size="sm">
                      {showUtcTime
                        ? "Show times in UTC"
                        : `Show times in local timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone})`}
                    </Text>
                  </Group>
                }
                checked={showUtcTime}
                onChange={(event) =>
                  setShowUtcTime(event.currentTarget.checked)
                }
              />
            </Tooltip>
          </Group>

          {logs && logs.length > 0 && (
            <TextInput
              placeholder="Search in logs..."
              leftSection={<IconSearch size={18} />}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.currentTarget.value)}
              style={{ maxWidth: 400 }}
            />
          )}
        </Stack>
      </Paper>

      {loading ? (
        <Group py="xl">
          <Loader size="lg" />
        </Group>
      ) : logs && logs.length > 0 ? (
        <>
          <Paper p="md" withBorder>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Timestamp</Table.Th>
                  <Table.Th>Actor</Table.Th>
                  <Table.Th>Action</Table.Th>
                  <Table.Th>Target</Table.Th>
                  <Table.Th>Request ID</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {currentLogs.map((log, index) => (
                  <Table.Tr key={`${log.requestId}-${index}`}>
                    <Table.Td>
                      <Group mt={0} mb={0}>
                        <Text size="sm">{formatTimestamp(log.createdAt)}</Text>
                        <Badge size="sm" color="gray">
                          <Group>
                            <Text size="xs">
                              {getRelativeTime(log.createdAt)}
                            </Text>
                          </Group>
                        </Badge>
                      </Group>
                    </Table.Td>
                    <Table.Td>{log.actor}</Table.Td>
                    <Table.Td>
                      <Text
                        size="sm"
                        style={{
                          whiteSpace: "normal",
                          wordBreak: "break-word",
                        }}
                      >
                        {log.message}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {selectedModule === Modules.AUDIT_LOG &&
                      Object.values(Modules).includes(log.target as Modules)
                        ? ModulesToHumanName[log.target as Modules]
                        : log.target}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {log.requestId}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Paper>

          {/* Pagination Controls */}
          <Group justify="space-between" mt="md">
            <Group>
              <Text size="sm">Items per page:</Text>
              <Select
                value={pageSize}
                onChange={(value) => {
                  setPageSize(value || "10");
                  setCurrentPage(1);
                }}
                data={pageSizeOptions}
                style={{ width: 80 }}
              />
              <Text size="sm">
                Showing {startIndex + 1} to {Math.min(endIndex, totalItems)} of{" "}
                {totalItems} entries
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
        </>
      ) : logs === null ? null : (
        <Paper p="xl" withBorder>
          <Group>
            <IconFileText size={48} opacity={0.3} />
            <Stack>
              <Title order={3}>No logs to display</Title>
              <Text variant="dimmed">
                {selectedModule
                  ? "Select a new time range and click 'Fetch Logs'"
                  : "Select a module and time range to fetch logs"}
              </Text>
            </Stack>
          </Group>
        </Paper>
      )}
    </Stack>
  );
};
