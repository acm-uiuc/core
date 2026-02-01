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
} from "@tabler/icons-react";
import * as z from "zod/v4";

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
  { value: "demographics", label: "Demographics (School Year)" },
  { value: "major", label: "Intended Major" },
  { value: "interests", label: "User Interests" },
  { value: "dietary", label: "Dietary Restrictions" },
  { value: "checkin", label: "Check-In Status" },
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

export const RsvpAnalyticsView: React.FC<RsvpAnalyticsViewProps> = ({
  eventId,
  getRsvps,
}) => {
  const [rsvps, setRsvps] = useState<RsvpData[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedView, setSelectedView] = useState<string>("overview");
  const [stats, setStats] = useState<AnalyticsStats>({
    totalRsvps: 0,
    totalPaidMembers: 0,
    totalCheckedIn: 0,
    schoolYearBreakdown: {},
    interestsBreakdown: {},
    majorBreakdown: {},
    dietaryRestrictionsBreakdown: {},
  });

  const fetchRsvps = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getRsvps(eventId);
      const validatedData = data.map((item) => rsvpSchema.parse(item));
      setRsvps(validatedData);
      calculateStats(data);
    } catch (error) {
      console.error("Error fetching RSVPs:", error);
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
        const interests = rsvp.interests || [];
        interests.forEach((interest) => {
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
        const restrictions = rsvp.dietaryRestrictions || [];
        restrictions.forEach((restriction) => {
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

  const renderDemographics = () => (
    <Paper withBorder p="lg" radius="md">
      <Title order={4} mb="md">
        School Year Breakdown
      </Title>
      {Object.keys(stats.schoolYearBreakdown).length > 0 ? (
        <Stack gap="md">
          {Object.entries(stats.schoolYearBreakdown)
            .sort(([, a], [, b]) => b - a)
            .map(([year, count]) => (
              <Group key={year} justify="space-between">
                <Text>{year}</Text>
                <Badge size="lg">{count}</Badge>
              </Group>
            ))}
        </Stack>
      ) : (
        <Box py="xl">
          <Text c="dimmed" ta="center">
            No school year data available for this event
          </Text>
        </Box>
      )}
    </Paper>
  );

  const renderInterests = () => (
    <Paper withBorder p="lg" radius="md">
      <Title order={4} mb="md">
        User Interests
      </Title>
      {Object.keys(stats.interestsBreakdown).length > 0 ? (
        <Stack gap="md">
          {Object.entries(stats.interestsBreakdown)
            .sort(([, a], [, b]) => b - a)
            .map(([interest, count]) => (
              <Group key={interest} justify="space-between">
                <Text>{interest}</Text>
                <Badge size="lg">{count}</Badge>
              </Group>
            ))}
        </Stack>
      ) : (
        <Box py="xl">
          <Text c="dimmed" ta="center">
            User interests data not available yet
          </Text>
        </Box>
      )}
    </Paper>
  );

  const renderMajor = () => (
    <Paper withBorder p="lg" radius="md">
      <Title order={4} mb="md">
        Intended Major Breakdown
      </Title>
      {Object.keys(stats.majorBreakdown).length > 0 ? (
        <Stack gap="md">
          {Object.entries(stats.majorBreakdown)
            .sort(([, a], [, b]) => b - a)
            .map(([major, count]) => (
              <Group key={major} justify="space-between">
                <Text>{major}</Text>
                <Badge size="lg">{count}</Badge>
              </Group>
            ))}
        </Stack>
      ) : (
        <Box py="xl">
          <Text c="dimmed" ta="center">
            No major data available for this event
          </Text>
        </Box>
      )}
    </Paper>
  );

  const renderDietary = () => (
    <Paper withBorder p="lg" radius="md">
      <Title order={4} mb="md">
        Dietary Restrictions
      </Title>
      {Object.keys(stats.dietaryRestrictionsBreakdown).length > 0 ? (
        <Stack gap="md">
          {Object.entries(stats.dietaryRestrictionsBreakdown)
            .sort(([, a], [, b]) => b - a)
            .map(([restriction, count]) => (
              <Group key={restriction} justify="space-between">
                <Text>{restriction}</Text>
                <Badge size="lg" color="orange">
                  {count}
                </Badge>
              </Group>
            ))}
        </Stack>
      ) : (
        <Box py="xl">
          <Text c="dimmed" ta="center">
            No dietary restrictions data available for this event
          </Text>
        </Box>
      )}
    </Paper>
  );

  const renderCheckinStatus = () => {
    const checkedInUsers = rsvps.filter((r) => r.checkedIn);
    const notCheckedInUsers = rsvps.filter((r) => !r.checkedIn);

    return (
      <Paper withBorder p="lg" radius="md">
        <Title order={4} mb="md">
          Check-In Status
        </Title>
        <Grid>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Paper withBorder p="md" bg="green.0">
              <Text fw={600} mb="sm" c="green.7">
                Checked In ({checkedInUsers.length})
              </Text>
              {checkedInUsers.length > 0 ? (
                <Stack gap="xs">
                  {checkedInUsers.map((rsvp) => (
                    <Group key={rsvp.userId} gap="xs">
                      <Badge size="sm" color="green" variant="dot">
                        {rsvp.userId}
                      </Badge>
                    </Group>
                  ))}
                </Stack>
              ) : (
                <Text size="sm" c="dimmed">
                  No one has checked in yet
                </Text>
              )}
            </Paper>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 6 }}>
            <Paper withBorder p="md" bg="orange.0">
              <Text fw={600} mb="sm" c="orange.7">
                Not Checked In ({notCheckedInUsers.length})
              </Text>
              {notCheckedInUsers.length > 0 ? (
                <Stack gap="xs">
                  {notCheckedInUsers.map((rsvp) => (
                    <Group key={rsvp.userId} gap="xs">
                      <Badge size="sm" color="orange" variant="dot">
                        {rsvp.userId}
                      </Badge>
                    </Group>
                  ))}
                </Stack>
              ) : (
                <Text size="sm" c="dimmed">
                  Everyone has checked in!
                </Text>
              )}
            </Paper>
          </Grid.Col>
        </Grid>
      </Paper>
    );
  };

  const renderSelectedView = () => {
    switch (selectedView) {
      case "overview":
        return renderOverview();
      case "demographics":
        return renderDemographics();
      case "major":
        return renderMajor();
      case "interests":
        return renderInterests();
      case "dietary":
        return renderDietary();
      case "checkin":
        return renderCheckinStatus();
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
