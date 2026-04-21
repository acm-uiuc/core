import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Container,
  Divider,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconCheck,
  IconClock,
  IconReceipt2,
} from "@tabler/icons-react";
import { useSearchParams } from "react-router-dom";

type StripeStatusResponse = {
  invoiceId: string;
  acmOrg: string;
  status: "paid" | "partial" | "pending" | "unpaid";
  invoiceAmountUsd: number;
  paidAmountUsd: number;
  remainingAmountUsd: number;
  lastPaidAt: string | null;
};

const formatMoney = (amount: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);

const formatDate = (value: string | null) => {
  if (!value) {
    return "Not yet settled";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

export const StripePaymentStatus: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [data, setData] = useState<StripeStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!token) {
        setErrored(true);
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(
          `/api/v1/stripe/status?token=${encodeURIComponent(token)}`,
        );

        if (!response.ok) {
          throw new Error(
            "Failed to load invoice status. Payment may still be pending, refresh in a few minutes.",
          );
        }

        const json = (await response.json()) as StripeStatusResponse;
        setData(json);
      } catch (e) {
        setErrored(true);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [token]);
  // for deploy comment
  const statusConfig = useMemo(() => {
    switch (data?.status) {
      case "paid":
        return {
          color: "teal",
          label: "Paid",
          icon: <IconCheck size={18} />,
          message: "This invoice has been paid successfully.",
        };
      case "partial":
        return {
          color: "yellow",
          label: "Partially Paid",
          icon: <IconClock size={18} />,
          message:
            "A payment was recorded, but there is still a remaining balance.",
        };
      case "pending":
        return {
          color: "blue",
          label: "Pending",
          icon: <IconClock size={18} />,
          message:
            "Your payment was submitted. Some payment methods, including ACH, may take additional time to settle.",
        };
      default:
        return {
          color: "gray",
          label: "Unpaid",
          icon: <IconReceipt2 size={18} />,
          message: "This invoice has not been paid yet.",
        };
    }
  }, [data?.status]);

  return (
    <Container size="sm" py={48}>
      <Paper
        radius="xl"
        p="xl"
        withBorder
        shadow="md"
        style={{
          background:
            "linear-gradient(180deg, rgba(248,249,250,1) 0%, rgba(255,255,255,1) 100%)",
        }}
      >
        {loading ? (
          <Center py={80}>
            <Stack align="center" gap="sm">
              <Loader size="lg" />
              <Text c="dimmed">Loading invoice status...</Text>
            </Stack>
          </Center>
        ) : errored || !data ? (
          <Alert
            color="red"
            icon={<IconAlertCircle size={18} />}
            radius="md"
            title="Unable to load invoice status"
          >
            We could not load this invoice status.
          </Alert>
        ) : (
          <Stack gap="lg">
            <Group justify="space-between" align="flex-start">
              <Group gap="md" align="center">
                <ThemeIcon
                  size={48}
                  radius="xl"
                  color={statusConfig.color}
                  variant="light"
                >
                  {statusConfig.icon}
                </ThemeIcon>
                <div>
                  <Title order={2}>Invoice Payment Status</Title>
                  <Text c="dimmed">
                    Review the latest payment information for this invoice.
                  </Text>
                </div>
              </Group>

              <Badge color={statusConfig.color} size="lg" radius="sm">
                {statusConfig.label}
              </Badge>
            </Group>

            <Alert
              color={statusConfig.color}
              icon={statusConfig.icon}
              radius="md"
            >
              {statusConfig.message}
            </Alert>

            <Card withBorder radius="lg" p="lg">
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text c="dimmed">Invoice ID</Text>
                  <Text fw={600}>{data.invoiceId}</Text>
                </Group>
                <Divider />
                <Group justify="space-between">
                  <Text c="dimmed">Organization</Text>
                  <Text fw={600}>{data.acmOrg}</Text>
                </Group>
                <Divider />
                <Group justify="space-between">
                  <Text c="dimmed">Last updated</Text>
                  <Text fw={600}>{formatDate(data.lastPaidAt)}</Text>
                </Group>
              </Stack>
            </Card>

            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
              <Card withBorder radius="lg" p="lg">
                <Text size="sm" c="dimmed" mb={6}>
                  Total
                </Text>
                <Title order={3}>{formatMoney(data.invoiceAmountUsd)}</Title>
              </Card>

              <Card withBorder radius="lg" p="lg">
                <Text size="sm" c="dimmed" mb={6}>
                  Paid So Far
                </Text>
                <Title order={3}>{formatMoney(data.paidAmountUsd)}</Title>
              </Card>

              <Card withBorder radius="lg" p="lg">
                <Text size="sm" c="dimmed" mb={6}>
                  Remaining
                </Text>
                <Title order={3}>{formatMoney(data.remainingAmountUsd)}</Title>
              </Card>
            </SimpleGrid>

            <Group justify="space-between" mt="sm">
              <Text size="sm" c="dimmed">
                Status updates may take a short time to appear after payment
                completion.
              </Text>

              <Button
                component="a"
                href="/"
                leftSection={<IconArrowLeft size={16} />}
                variant="light"
              >
                Done
              </Button>
            </Group>
          </Stack>
        )}
      </Paper>
    </Container>
  );
};

export default StripePaymentStatus;
