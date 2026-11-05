import { useState } from "react";
import {
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { ZodError } from "zod/v4";
import { fromError } from "zod-validation-error";
import { OrganizationId } from "@acm-uiuc/js-shared";
import { ManageableOrgsSelector } from "@ui/components/ManageableOrgsSelector";
import { getSemesters } from "@common/semesters";
import {
  FundingRequestCreate,
  fundingRequestCreateSchema,
  FundingRequestPostResponse,
  formatCentsAsUsd,
} from "@common/types/fundingRequest";

interface NewFundingRequestProps {
  createFundingRequest: (
    payload: FundingRequestCreate,
  ) => Promise<FundingRequestPostResponse>;
}

// What the form holds while the user types. Amount is in dollars here and
// becomes cents only when we build the API payload.
export interface FormValues {
  semesterId: string | null;
  orgId: OrganizationId | null;
  title: string;
  description: string;
  amountDollars: number | string;
}

const emptyValues = (semesterId: string | null): FormValues => ({
  semesterId,
  orgId: null,
  title: "",
  description: "",
  amountDollars: "",
});

// Turns the form's values into exactly the body POST /fundingRequests expects.
export const buildFundingRequestPayload = (values: FormValues) => ({
  semesterId: values.semesterId,
  orgId: values.orgId,
  title: values.title.trim(),
  description: values.description.trim(),
  requestedAmountCents: Math.round(Number(values.amountDollars) * 100),
});

const NewFundingRequest: React.FC<NewFundingRequestProps> = ({
  createFundingRequest,
}) => {
  const semesterOptions = getSemesters();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [noOrgs, setNoOrgs] = useState(false);
  const form = useForm<FormValues>({
    initialValues: emptyValues(semesterOptions[0]?.value ?? null),
  });

  const handleSubmit = async () => {
    if (isSubmitting) {
      return;
    }
    let payload: FundingRequestCreate;
    try {
      payload = await fundingRequestCreateSchema.parseAsync(
        buildFundingRequestPayload(form.values),
      );
    } catch (e) {
      notifications.show({
        title: "Please fix the form",
        message:
          e instanceof ZodError
            ? fromError(e).toString()
            : "Check the browser console for more details.",
        color: "red",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await createFundingRequest(payload);
      notifications.show({
        title: "Funding request submitted!",
        message: `Request for ${formatCentsAsUsd(payload.requestedAmountCents)} sent to the treasurer (ID ${response.id}).`,
      });
      form.setValues(emptyValues(form.values.semesterId));
    } catch (e: any) {
      notifications.show({
        title: "Failed to submit funding request",
        message:
          e?.response?.data?.message ?? "Please try again or contact support.",
        color: "red",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (noOrgs) {
    return (
      <Text c="dimmed" mt="sm">
        You need to be a lead of an organization to create funding requests.
      </Text>
    );
  }

  return (
    <Stack gap="sm" mt="sm">
      <Select
        label="Semester"
        withAsterisk
        data={semesterOptions}
        {...form.getInputProps("semesterId")}
      />
      <ManageableOrgsSelector
        // Empty list: even admins only see orgs they lead, matching the API's check.
        adminRoles={[]}
        label="Organization"
        placeholder="Select the organization requesting money"
        withAsterisk
        value={form.values.orgId}
        onChange={(org) => form.setFieldValue("orgId", org)}
        onOrgsLoaded={(orgs) => {
          setNoOrgs(orgs.length === 0);
          if (orgs.length === 1) {
            form.setFieldValue("orgId", orgs[0]);
          }
        }}
      />
      <TextInput
        label="Title"
        withAsterisk
        placeholder="Hackathon pizza"
        {...form.getInputProps("title")}
      />
      <Textarea
        label="Description"
        description="What the money is for and why."
        withAsterisk
        autosize
        minRows={3}
        {...form.getInputProps("description")}
      />
      <NumberInput
        label="Amount (USD)"
        withAsterisk
        prefix="$"
        min={0}
        decimalScale={2}
        fixedDecimalScale
        thousandSeparator=","
        {...form.getInputProps("amountDollars")}
      />

      <Group justify="flex-end" mt="md">
        <Button onClick={handleSubmit} loading={isSubmitting} color="green">
          Submit request
        </Button>
      </Group>
    </Stack>
  );
};

export default NewFundingRequest;
