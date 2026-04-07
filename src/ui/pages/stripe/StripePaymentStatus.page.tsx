import React, { useEffect, useState } from "react";
import {
  Badge,
  Card,
  Container,
  Group,
  Loader,
  Stack,
  Text,
  Title,
  Alert,
  Button,
} from "@mantine/core";
import { IconAlertCircle, IconCheck, IconClock } from "@tabler/icons-react";
import { useSearchParams } from "react-router-dom";
import { useApi } from "@ui/util/api";

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

export const StripePaymentStatus: React.FC = () => {
  const api = useApi("core");
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
        const response = await api.get("/api/v1/stripe/status", {
          params: { token },
        });
        setData(response.data);
      } catch (e) {
        setErrored(true);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [api, token]);

  const badgeColor =
    data?.status === "paid"
      ? "teal"
      : data?.status === "partial"
        ? "yellow"
        : data?.status === "pending"
          ? "blue"
          : "gray";

  const badgeLabel =
    data?.status === "paid"
      ? "Paid"
      : data?.status === "partial"
        ? "Partially Paid"
        : data?.status === "pending"
          ? "Pending"
          : "Unpaid";

  return (
    <Container size="sm" py="xl">
      <Card withBorder radius="md" p="xl">
        {loading ? (
          <Group justify="center" py="xl">
            <Loader />
          </Group>
        ) : errored || !data ? (
          <Alert color="red" icon={<IconAlertCircle size={16} />}>
            We could not load this invoice status.
          </Alert>
        ) : (
          <Stack gap="md">
            <Group justify="space-between" align="center">
              <Title order={2}>Payment Status</Title>
              <Badge color={badgeColor} size="lg">
                {badgeLabel}
              </Badge>
            </Group>

            <Text>
              Invoice <b>{data.invoiceId}</b>
            </Text>

            <Text>
              Organization: <b>{data.acmOrg}</b>
            </Text>

            <Card withBorder radius="md" p="md">
              <Stack gap="xs">
                <Text>Total: {formatMoney(data.invoiceAmountUsd)}</Text>
                <Text>Paid so far: {formatMoney(data.paidAmountUsd)}</Text>
                <Text>Remaining: {formatMoney(data.remainingAmountUsd)}</Text>
                <Text>
                  Last updated: {data.lastPaidAt ?? "Not yet settled"}
                </Text>
              </Stack>
            </Card>

            {data.status === "paid" && (
              <Alert color="teal" icon={<IconCheck size={16} />}>
                This invoice has been paid successfully.
              </Alert>
            )}

            {data.status === "partial" && (
              <Alert color="yellow" icon={<IconClock size={16} />}>
                A payment was recorded, but there is still a remaining balance.
              </Alert>
            )}

            {data.status === "pending" && (
              <Alert color="blue" icon={<IconClock size={16} />}>
                Your payment was submitted. Some payment methods, including ACH,
                may take additional time to settle.
              </Alert>
            )}

            <Group>
              <Button component="a" href="/">
                Done
              </Button>
            </Group>
          </Stack>
        )}
      </Card>
    </Container>
  );
};

export default StripePaymentStatus;
