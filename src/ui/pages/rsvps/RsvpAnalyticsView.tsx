import React, { useEffect, useState, useCallback } from "react";
import {
  Box,
  Title,
  Text,
  Paper,
  Group,
  Stack,
  Select,
  Grid,
  LoadingOverlay,
  Badge,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconUsers,
  IconCreditCard,
  IconCheck,
  IconChartBar,
  IconX,
} from "@tabler/icons-react";
import * as z from "zod/v4";
import { ResponsiveTable, Column } from "@ui/components/ResponsiveTable";

const rsvpSchema = z.object({
  eventId: z.string(),
  userId: z.string(),
  isPaidMember: z.boolean(),
  checkedIn: z.boolean(),
  createdAt: z.number(),
  schoolYear: z.string(),
  intendedMajor: z.string(),
  dietaryRestrictions: z.array(z.string()),
  interests: z.array(z.string()),
});

type RsvpData = z.infer<typeof rsvpSchema>;

interface RsvpAnalyticsViewProps {
  eventId: string;
  getRsvps: (eventId: string) => Promise<RsvpData[]>;
}

const analyticsViews = [
  { value: "overview", label: "Overview Statistics" },
  { value: "attendees", label: "All Attendees" },
  { value: "demographics", label: "Demographics (School Year)" },
  { value: "major", label: "Intended Major" },
  { value: "interests", label: "User Interests" },
  { value: "dietary", label: "Dietary Restrictions" },
] as const;

interface AnalyticsStats {
  totalRsvps: number;
  totalPaidMembers: number;
  totalCheckedIn: number;
  schoolYearBreakdown: Record<string, number>;
  interestsBreakdown: Record<string, number>;
  majorBreakdown: Record<string, number>;
  dietaryRestrictionsBreakdown: Record<string, number>;
}

interface BreakdownRow {
  label: string;
  count: number;
}

export const RsvpAnalyticsView: React.FC<RsvpAnalyticsViewProps> = ({
  eventId,
  getRsvps,
}) => {
  const [rsvps, setRsvps] = useState<RsvpData[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedView, setSelectedView] = useState<string>("attendees");
  const [stats, setStats] = useState<AnalyticsStats>({
    totalRsvps: 0,
    totalPaidMembers: 0,
    totalCheckedIn: 0,
    schoolYearBreakdown: {},
    interestsBreakdown: {},
    majorBreakdown: {},
    dietaryRestrictionsBreakdown: {},
  });

  const calculateStats = (rsvpData: RsvpData[]) => {
    const totalRsvps = rsvpData.length;
    const totalPaidMembers = rsvpData.filter((r) => r.isPaidMember).length;
    const totalCheckedIn = rsvpData.filter((r) => r.checkedIn).length;

    const schoolYearBreakdown = rsvpData.reduce(
      (acc, rsvp) => {
        const year = rsvp.schoolYear || "Unknown";
        acc[year] = (acc[year] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const interestsBreakdown = rsvpData.reduce(
      (acc, rsvp) => {
        (rsvp.interests || []).forEach((interest) => {
          acc[interest] = (acc[interest] || 0) + 1;
        });
        return acc;
      },
      {} as Record<string, number>,
    );

    const majorBreakdown = rsvpData.reduce(
      (acc, rsvp) => {
        const major = rsvp.intendedMajor || "Unknown";
        acc[major] = (acc[major] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const dietaryRestrictionsBreakdown = rsvpData.reduce(
      (acc, rsvp) => {
        (rsvp.dietaryRestrictions || []).forEach((restriction) => {
          acc[restriction] = (acc[restriction] || 0) + 1;
        });
        return acc;
      },
      {} as Record<string, number>,
    );

    setStats({
      totalRsvps,
      totalPaidMembers,
      totalCheckedIn,
      schoolYearBreakdown,
      interestsBreakdown,
      majorBreakdown,
      dietaryRestrictionsBreakdown,
    });
  };

  const fetchRsvps = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getRsvps(eventId);
      const validatedData = data.map((item) => rsvpSchema.parse(item));
      setRsvps(validatedData);
      calculateStats(validatedData);
    } catch (error) {
      setRsvps([]);
      setStats({
        totalRsvps: 0,
        totalPaidMembers: 0,
        totalCheckedIn: 0,
        schoolYearBreakdown: {},
        interestsBreakdown: {},
        majorBreakdown: {},
        dietaryRestrictionsBreakdown: {},
      });
      notifications.show({
        title: "Error fetching RSVPs",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  }, [eventId, getRsvps]);

  useEffect(() => {
    fetchRsvps();
  }, [fetchRsvps]);

  const breakdownTableData = (
    breakdown: Record<string, number>,
  ): BreakdownRow[] =>
    Object.entries(breakdown)
      .sort(([, a], [, b]) => b - a)
      .map(([label, count]) => ({ label, count }));

  const renderOverview = () => (
    <Grid>
      <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
        <Paper withBorder p="md" radius="md">
          <Group>
            <IconUsers size={32} color="var(--mantine-color-blue-6)" />
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                Total RSVPs
              </Text>
              <Text size="xl" fw={700}>
                {stats.totalRsvps}
              </Text>
            </div>
          </Group>
        </Paper>
      </Grid.Col>
      <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
        <Paper withBorder p="md" radius="md">
          <Group>
            <IconCreditCard size={32} color="var(--mantine-color-green-6)" />
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                Paid Members
              </Text>
              <Text size="xl" fw={700}>
                {stats.totalPaidMembers}
              </Text>
            </div>
          </Group>
        </Paper>
      </Grid.Col>
      <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
        <Paper withBorder p="md" radius="md">
          <Group>
            <IconCheck size={32} color="var(--mantine-color-teal-6)" />
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                Checked In
              </Text>
              <Text size="xl" fw={700}>
                {stats.totalCheckedIn}
              </Text>
            </div>
          </Group>
        </Paper>
      </Grid.Col>
      <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
        <Paper withBorder p="md" radius="md">
          <Group>
            <IconChartBar size={32} color="var(--mantine-color-violet-6)" />
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                Attendance Rate
              </Text>
              <Text size="xl" fw={700}>
                {stats.totalRsvps > 0
                  ? `${Math.round((stats.totalCheckedIn / stats.totalRsvps) * 100)}%`
                  : "N/A"}
              </Text>
            </div>
          </Group>
        </Paper>
      </Grid.Col>
    </Grid>
  );

  const renderAttendees = () => {
    const columns: Column<RsvpData>[] = [
      {
        key: "userId",
        label: "User",
        isPrimaryColumn: true,
        render: (rsvp) => rsvp.userId,
      },
      {
        key: "schoolYear",
        label: "Year",
        render: (rsvp) => rsvp.schoolYear || "—",
      },
      {
        key: "intendedMajor",
        label: "Major",
        render: (rsvp) => rsvp.intendedMajor || "—",
      },
      {
        key: "isPaidMember",
        label: "Member",
        render: (rsvp) => (
          <Badge color={rsvp.isPaidMember ? "blue" : "gray"}>
            {rsvp.isPaidMember ? "Paid" : "Free"}
          </Badge>
        ),
      },
      {
        key: "checkedIn",
        label: "Check-In",
        render: (rsvp) =>
          rsvp.checkedIn ? <IconCheck color="green" /> : <IconX color="red" />,
      },
      {
        key: "rsvpedAt",
        label: "RSVPed At",
        render: (rsvp) =>
          rsvp.createdAt
            ? new Date(rsvp.createdAt * 1000).toLocaleString()
            : "—",
      },
      {
        key: "dietaryRestrictions",
        label: "Dietary",
        render: (rsvp) =>
          rsvp.dietaryRestrictions.length > 0 ? (
            <Group gap="xs">
              {rsvp.dietaryRestrictions.map((r) => (
                <Badge key={r} color="orange" size="sm">
                  {r}
                </Badge>
              ))}
            </Group>
          ) : (
            <Text size="sm" c="dimmed">
              None
            </Text>
          ),
      },
      {
        key: "interests",
        label: "Interests",
        render: (rsvp) =>
          rsvp.interests.length > 0 ? (
            <Group gap="xs">
              {rsvp.interests.map((i) => (
                <Badge key={i} color="violet" size="sm">
                  {i}
                </Badge>
              ))}
            </Group>
          ) : (
            <Text size="sm" c="dimmed">
              None
            </Text>
          ),
      },
    ];

    return (
      <Paper withBorder p="lg" radius="md">
        <Title order={4} mb="md">
          All Attendees ({rsvps.length})
        </Title>
        {rsvps.length > 0 ? (
          <ResponsiveTable
            data={rsvps}
            columns={columns}
            keyExtractor={(rsvp) => rsvp.userId}
            testIdPrefix="attendee-row"
            testId="attendees-table"
          />
        ) : (
          <Text c="dimmed" ta="center" py="xl">
            No RSVPs for this event yet
          </Text>
        )}
      </Paper>
    );
  };

  const renderBreakdownTable = (
    title: string,
    breakdown: Record<string, number>,
    emptyMessage: string,
    badgeColor?: string,
  ) => {
    const data = breakdownTableData(breakdown);
    const columns: Column<BreakdownRow>[] = [
      {
        key: "label",
        label: "Name",
        isPrimaryColumn: true,
        render: (row) => row.label,
      },
      {
        key: "count",
        label: "Count",
        render: (row) => (
          <Badge size="lg" color={badgeColor}>
            {row.count}
          </Badge>
        ),
      },
    ];

    return (
      <Paper withBorder p="lg" radius="md">
        <Title order={4} mb="md">
          {title}
        </Title>
        {data.length > 0 ? (
          <ResponsiveTable
            data={data}
            columns={columns}
            keyExtractor={(row) => row.label}
            testIdPrefix="breakdown-row"
          />
        ) : (
          <Box py="xl">
            <Text c="dimmed" ta="center">
              {emptyMessage}
            </Text>
          </Box>
        )}
      </Paper>
    );
  };

  const renderSelectedView = () => {
    switch (selectedView) {
      case "overview":
        return renderOverview();
      case "attendees":
        return renderAttendees();
      case "demographics":
        return renderBreakdownTable(
          "School Year Breakdown",
          stats.schoolYearBreakdown,
          "No school year data available for this event",
        );
      case "major":
        return renderBreakdownTable(
          "Intended Major Breakdown",
          stats.majorBreakdown,
          "No major data available for this event",
        );
      case "interests":
        return renderBreakdownTable(
          "User Interests",
          stats.interestsBreakdown,
          "User interests data not available yet",
        );
      case "dietary":
        return renderBreakdownTable(
          "Dietary Restrictions",
          stats.dietaryRestrictionsBreakdown,
          "No dietary restrictions data available for this event",
          "orange",
        );
      default:
        return renderOverview();
    }
  };

  return (
    <Box pos="relative">
      <LoadingOverlay visible={loading} />
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Title order={4}>Analytics Dashboard</Title>
          <Select
            placeholder="Select view"
            data={analyticsViews}
            value={selectedView}
            onChange={(value) => setSelectedView(value || "overview")}
            style={{ width: 250 }}
          />
        </Group>
        {renderSelectedView()}
      </Stack>
    </Box>
  );
};
