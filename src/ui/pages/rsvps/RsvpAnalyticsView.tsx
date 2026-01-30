import React, { useEffect, useState } from "react";
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
  createdAt: z.number(),
});

type RsvpData = z.infer<typeof rsvpSchema>;

interface RsvpAnalyticsViewProps {
  eventId: string;
  getRsvps: (eventId: string) => Promise<RsvpData[]>;
}

// Analytics view types
const analyticsViews = [
  { value: "overview", label: "Overview Statistics" },
  { value: "demographics", label: "Demographics (School Year)" },
  { value: "interests", label: "User Interests" },
  { value: "checkin", label: "Check-In Status" },
  { value: "responses", label: "Question Responses" },
] as const;

interface AnalyticsStats {
  totalRsvps: number;
  totalPaidMembers: number;
  totalCheckedIn: number;
  schoolYearBreakdown: Record<string, number>;
  interestsBreakdown: Record<string, number>;
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
  });

  useEffect(() => {
    fetchRsvps();
  }, [eventId]);

  const fetchRsvps = async () => {
    setLoading(true);
    try {
      const data = await getRsvps(eventId);
      setRsvps(data);
      calculateStats(data);
    } catch (error) {
      console.error("Error fetching RSVPs:", error);
      notifications.show({
        title: "Error fetching RSVPs",
        message: `${error}`,
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (rsvpData: RsvpData[]) => {
    const totalRsvps = rsvpData.length;
    const totalPaidMembers = rsvpData.filter((r) => r.isPaidMember).length;

    // Mock functions for future features
    // TODO: Implement when isCheckedIn field is added to RSVP data
    const totalCheckedIn = 0;
    // const totalCheckedIn = rsvpData.filter((r) => r.isCheckedIn).length;

    // TODO: Implement when user profile includes schoolYear
    // const schoolYearBreakdown = rsvpData.reduce((acc, rsvp) => {
    //   const year = rsvp.user?.schoolYear || "Unknown";
    //   acc[year] = (acc[year] || 0) + 1;
    //   return acc;
    // }, {} as Record<string, number>);
    const schoolYearBreakdown: Record<string, number> = {};

    // TODO: Implement when user profile includes interests
    // const interestsBreakdown = rsvpData.reduce((acc, rsvp) => {
    //   const interests = rsvp.user?.interests || [];
    //   interests.forEach((interest) => {
    //     acc[interest] = (acc[interest] || 0) + 1;
    //   });
    //   return acc;
    // }, {} as Record<string, number>);
    const interestsBreakdown: Record<string, number> = {};

    setStats({
      totalRsvps,
      totalPaidMembers,
      totalCheckedIn,
      schoolYearBreakdown,
      interestsBreakdown,
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
              <Badge size="xs" color="yellow" variant="light" mt={4}>
                Coming Soon
              </Badge>
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
              <Badge size="xs" color="yellow" variant="light" mt={4}>
                Coming Soon
              </Badge>
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
          {Object.entries(stats.schoolYearBreakdown).map(([year, count]) => (
            <Group key={year} justify="space-between">
              <Text>{year}</Text>
              <Badge size="lg">{count}</Badge>
            </Group>
          ))}
        </Stack>
      ) : (
        <Box py="xl">
          <Text c="dimmed" ta="center">
            School year data not available yet
          </Text>
          <Badge
            color="yellow"
            variant="light"
            mt="sm"
            style={{ display: "block", margin: "0 auto", width: "fit-content" }}
          >
            Coming Soon
          </Badge>
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
          <Badge
            color="yellow"
            variant="light"
            mt="sm"
            style={{ display: "block", margin: "0 auto", width: "fit-content" }}
          >
            Coming Soon
          </Badge>
        </Box>
      )}
    </Paper>
  );

  const renderCheckinStatus = () => (
    <Paper withBorder p="lg" radius="md">
      <Title order={4} mb="md">
        Check-In Status
      </Title>
      <Box py="xl">
        <Text c="dimmed" ta="center">
          Check-in tracking will be available here
        </Text>
        <Text size="sm" c="dimmed" ta="center" mt="xs">
          This will show who has checked in vs who has only RSVPed
        </Text>
        <Badge
          color="yellow"
          variant="light"
          mt="md"
          style={{ display: "block", margin: "0 auto", width: "fit-content" }}
        >
          Coming Soon
        </Badge>
      </Box>
    </Paper>
  );

  const renderQuestionResponses = () => (
    <Paper withBorder p="lg" radius="md">
      <Title order={4} mb="md">
        Question Responses
      </Title>
      <Box py="xl">
        <Text c="dimmed" ta="center">
          Custom question responses will be aggregated here
        </Text>
        <Text size="sm" c="dimmed" ta="center" mt="xs">
          View responses to dietary restrictions, t-shirt sizes, and other
          custom questions
        </Text>
        <Badge
          color="yellow"
          variant="light"
          mt="md"
          style={{ display: "block", margin: "0 auto", width: "fit-content" }}
        >
          Coming Soon
        </Badge>
      </Box>
    </Paper>
  );

  const renderSelectedView = () => {
    switch (selectedView) {
      case "overview":
        return renderOverview();
      case "demographics":
        return renderDemographics();
      case "interests":
        return renderInterests();
      case "checkin":
        return renderCheckinStatus();
      case "responses":
        return renderQuestionResponses();
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
