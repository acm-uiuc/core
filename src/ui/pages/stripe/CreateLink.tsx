import {
  Box,
  Button,
  CopyButton,
  Group,
  Loader,
  Modal,
  NumberInput,
  Select,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import React, { useEffect, useRef, useState } from "react";
import {
  PostInvoiceLinkRequest,
  PostInvoiceLinkResponse,
  RampFund,
  RampFundsResponse,
} from "@common/types/stripe";
import { generateErrorMessage } from "@ui/util/api";

interface StripeCreateLinkPanelProps {
  createLink: (
    payload: PostInvoiceLinkRequest,
  ) => Promise<PostInvoiceLinkResponse>;
  getRampFunds: () => Promise<RampFundsResponse>;
}

type FundsState =
  | { status: "loading" }
  | { status: "connected"; funds: RampFund[] }
  | { status: "not_linked" }
  | { status: "unavailable" };

export const StripeCreateLinkPanel: React.FC<StripeCreateLinkPanelProps> = ({
  createLink,
  getRampFunds,
}) => {
  const [modalOpened, setModalOpened] = useState(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [returnedLink, setReturnedLink] = useState<string | null>(null);
  const [fundsState, setFundsState] = useState<FundsState>({
    status: "loading",
  });
  const [selectedFundId, setSelectedFundId] = useState<string | null>(null);

  const requestGeneration = useRef(0);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const loadRampFunds = async () => {
    const generation = ++requestGeneration.current;
    setFundsState({ status: "loading" });
    try {
      const response = await getRampFunds();
      if (!isMounted.current || generation !== requestGeneration.current) {
        return;
      }
      if (response.status === "connected") {
        setFundsState({ status: "connected", funds: response.funds });
      } else if (response.status === "not_linked") {
        setFundsState({ status: "not_linked" });
      } else {
        setFundsState({ status: "unavailable" });
      }
    } catch {
      if (!isMounted.current || generation !== requestGeneration.current) {
        return;
      }
      setFundsState({ status: "unavailable" });
    }
  };

  useEffect(() => {
    loadRampFunds();
  }, []);

  const form = useForm({
    initialValues: {
      invoiceId: "",
      invoiceAmountUsd: 100,
      contactName: "",
      contactEmail: "",
      achPaymentsEnabled: false,
    },
    validate: {
      invoiceId: (value) =>
        value.length < 1 ? "Invoice ID is required" : null,
      invoiceAmountUsd: (value) =>
        value < 0.5 ? "Amount must be at least $0.50" : null,
      contactName: (value) =>
        value.length < 1 ? "Contact Name is required" : null,
      contactEmail: (value) =>
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : "Invalid email",
      achPaymentsEnabled: (value) =>
        value ? "Feature not yet available" : null,
    },
  });

  const selectedFund =
    fundsState.status === "connected"
      ? (fundsState.funds.find((fund) => fund.id === selectedFundId) ?? null)
      : null;

  const selectedFundInvalid = selectedFundId !== null && selectedFund === null;

  const selectDisabled =
    fundsState.status !== "connected" && selectedFundId === null;

  const fundOptions =
    fundsState.status === "connected"
      ? fundsState.funds.map((fund) => ({
          value: fund.id,
          label: fund.displayName,
        }))
      : [];

  const handleSubmit = async (values: typeof form.values) => {
    if (isLoading || selectedFundInvalid) {
      return;
    }
    try {
      setIsLoading(true);
      const payload: PostInvoiceLinkRequest = {
        ...values,
        ...(selectedFund ? { rampFundId: selectedFund.id } : {}),
      };
      const response = await createLink(payload);
      setReturnedLink(response.link);
      setSelectedFundId(null);
      setIsLoading(false);
      setModalOpened(true);
      form.reset();
    } catch (e) {
      setIsLoading(false);
      await generateErrorMessage(e, "creating a payment link");
    }
  };

  return (
    <Box mt="xl" mb="xl">
      <Title order={2} mb="sm">
        Create a Payment Link
      </Title>
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <TextInput
          label="Invoice ID"
          placeholder="ACM100"
          description="Make sure the Invoice ID is prefixed with a unique string for your group to avoid processing delays."
          {...form.getInputProps("invoiceId")}
          required
        />
        <NumberInput
          label="Invoice Amount"
          leftSectionPointerEvents="none"
          leftSection={<Text>$</Text>}
          placeholder="100"
          min={0.5}
          {...form.getInputProps("invoiceAmountUsd")}
          required
        />
        <TextInput
          label="Invoice Recipient Name"
          placeholder="John Doe"
          {...form.getInputProps("contactName")}
          required
        />
        <TextInput
          label="Invoice Recipient Email"
          placeholder="email@illinois.edu"
          {...form.getInputProps("contactEmail")}
          required
        />
        <Switch
          mt="lg"
          mb="lg"
          label="Enable ACH Payment (upcoming)"
          description="Accept only bank transfer payments for this link"
          disabled
          {...form.getInputProps("achPaymentsEnabled")}
        />

        <Box mt="lg">
          <Group justify="space-between" mb={6}>
            <Text
              component="label"
              htmlFor="ramp-fund-select"
              size="sm"
              fw={500}
            >
              Ramp fund (optional)
            </Text>
            <Button variant="subtle" size="compact-xs" onClick={loadRampFunds}>
              Refresh
            </Button>
          </Group>
          <Select
            id="ramp-fund-select"
            aria-label="Ramp fund"
            placeholder="Search for a Ramp fund"
            description="Net proceeds increase a non-repeating spending limit, not a banking balance."
            searchable
            clearable
            clearButtonProps={{ "aria-label": "Clear Ramp fund" }}
            data={fundOptions}
            value={selectedFundId}
            onChange={(value) => setSelectedFundId(value)}
            disabled={selectDisabled}
            nothingFoundMessage="No matching funds"
            error={
              selectedFundInvalid
                ? "This fund is no longer eligible. Clear or choose a different fund."
                : undefined
            }
          />
          {fundsState.status === "loading" && (
            <Text size="sm" c="dimmed" mt={4}>
              Loading Ramp funds…
            </Text>
          )}
          {fundsState.status === "not_linked" && (
            <Text size="sm" c="dimmed" mt={4}>
              No Ramp account is linked to your ACM identity.
            </Text>
          )}
          {fundsState.status === "connected" &&
            fundsState.funds.length === 0 && (
              <Text size="sm" c="dimmed" mt={4}>
                No eligible Ramp funds are available.
              </Text>
            )}
          {fundsState.status === "unavailable" && (
            <Text size="sm" c="red" mt={4}>
              Ramp is currently unavailable.
            </Text>
          )}
        </Box>

        <Button
          type="submit"
          fullWidth
          mt="md"
          disabled={isLoading || selectedFundInvalid}
        >
          {isLoading ? "Creating..." : "Create Link"}{" "}
          {isLoading && <Loader color="blue" size="sm" ml="sm" />}
        </Button>
      </form>

      <Modal
        opened={modalOpened}
        size="xl"
        onClose={() => setModalOpened(false)}
        title="Payment Link Created!"
        closeOnClickOutside={false}
        withCloseButton
      >
        {returnedLink && (
          <Box mt="md">
            <Group>
              <Text color="blue">{returnedLink}</Text>
              <CopyButton value={returnedLink}>
                {({ copied, copy }) => (
                  <Button color={copied ? "teal" : "blue"} onClick={copy}>
                    {copied ? "Copied!" : "Copy Link"}
                  </Button>
                )}
              </CopyButton>
            </Group>
            <Text mt="sm">
              Provide this link to your billing contact for payment.
            </Text>
          </Box>
        )}
      </Modal>
    </Box>
  );
};

export default StripeCreateLinkPanel;
