import React, { useState } from "react";
import {
  Modal,
  TextInput,
  Textarea,
  Switch,
  Select,
  NumberInput,
  Button,
  Group,
  Stack,
  Paper,
  Divider,
  ActionIcon,
  Text,
  TagsInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconTrash, IconPlus } from "@tabler/icons-react";
import * as z from "zod/v4";
import { zod4Resolver as zodResolver } from "mantine-form-zod-resolver";
import { UrbanaDateTimePicker } from "@ui/components/UrbanaDateTimePicker";
import { NonUrbanaTimezoneAlert } from "@ui/components/NonUrbanaTimezoneAlert";
import {
  ImageUpload,
  type ImageUploadResult,
} from "@ui/components/ImageUpload";
import { useApi } from "@ui/util/api";
import { uploadToS3PresignedUrl } from "@ui/util/s3";
import type { CreateProductRequest } from "@common/types/store";

const createVariantFormSchema = z.object({
  name: z.string().min(1, "Variant name is required"),
  description: z.string().optional(),
  imageUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  memberPriceDollars: z.number().min(0, "Must be non-negative"),
  nonmemberPriceDollars: z.number().min(0, "Must be non-negative"),
  inventoryCount: z.number().int().min(0).nullable().optional(),
  exchangesAllowed: z.boolean(),
  memberLists: z
    .array(z.string())
    .min(1, "At least one member list is required"),
});

const createProductFormSchema = z
  .object({
    productId: z.string().min(1, "Product ID is required"),
    name: z.string().min(1, "Name is required"),
    description: z.string().optional(),
    openAt: z.number().int().gte(0).optional(),
    closeAt: z.number().int().min(0).optional(),
    verifiedIdentityRequired: z.boolean(),
    variantFriendlyName: z.string().min(1).max(30).optional(),
    inventoryMode: z.enum(["PER_VARIANT", "PER_PRODUCT"]),
    totalInventoryCount: z.number().int().min(0).nullable().optional(),
    limitConfiguration: z
      .object({
        limitType: z.enum(["PER_PRODUCT", "PER_VARIANT"]),
        maxQuantity: z.number().int().positive("Must be a positive integer"),
      })
      .optional(),
    additionalEmailText: z.string().optional(),
    variants: z
      .array(createVariantFormSchema)
      .min(1, "At least one variant is required"),
  })
  .refine(
    (data) => !data.openAt || !data.closeAt || data.openAt < data.closeAt,
    { message: "Open date must be before close date", path: ["closeAt"] },
  )
  .refine(
    (data) =>
      data.inventoryMode !== "PER_PRODUCT" || data.totalInventoryCount != null,
    {
      message:
        "Total inventory count is required when inventory mode is PER_PRODUCT",
      path: ["totalInventoryCount"],
    },
  );

type CreateProductFormValues = z.infer<typeof createProductFormSchema>;

const defaultVariant: CreateProductFormValues["variants"][number] = {
  name: "",
  description: "",
  imageUrl: "",
  memberPriceDollars: 0,
  nonmemberPriceDollars: 0,
  inventoryCount: 0,
  exchangesAllowed: true,
  memberLists: ["acmpaid"],
};

interface CreateProductModalProps {
  opened: boolean;
  onClose: () => void;
  onProductCreated: () => void;
}

export const CreateProductModal: React.FC<CreateProductModalProps> = ({
  opened,
  onClose,
  onProductCreated,
}) => {
  const api = useApi("core");
  const [saving, setSaving] = useState(false);
  const [purchaseLimitEnabled, setPurchaseLimitEnabled] = useState(false);
  const [imageUploadResult, setImageUploadResult] =
    useState<ImageUploadResult | null>(null);
  const nowEpoch = Math.round(new Date().getTime() / 1000);

  const form = useForm<CreateProductFormValues>({
    mode: "controlled",
    validate: zodResolver(createProductFormSchema),
    initialValues: {
      productId: "",
      name: "",
      description: "",
      openAt: nowEpoch,
      closeAt: nowEpoch + 604800, // closes in a week,
      verifiedIdentityRequired: true,
      variantFriendlyName: "Size",
      inventoryMode: "PER_VARIANT",
      totalInventoryCount: null,
      limitConfiguration: undefined,
      additionalEmailText: "",
      variants: [{ ...defaultVariant }],
    },
  });

  const handleSubmit = async () => {
    const validation = form.validate();
    if (validation.hasErrors) {
      return;
    }

    const values = form.values;

    const variants: CreateProductRequest["variants"] = values.variants.map(
      (v) => ({
        name: v.name,
        description: v.description || undefined,
        imageUrl: v.imageUrl || undefined,
        memberPriceCents: Math.round(v.memberPriceDollars * 100),
        nonmemberPriceCents: Math.round(v.nonmemberPriceDollars * 100),
        inventoryCount: v.inventoryCount,
        exchangesAllowed: v.exchangesAllowed,
        memberLists: v.memberLists,
      }),
    );

    const requestBody: CreateProductRequest = {
      productId: values.productId,
      name: values.name,
      description: values.description || undefined,
      openAt: values.openAt,
      closeAt: values.closeAt,
      verifiedIdentityRequired: values.verifiedIdentityRequired,
      variantFriendlyName: values.variantFriendlyName || "Size",
      inventoryMode: values.inventoryMode,
      totalInventoryCount:
        values.inventoryMode === "PER_PRODUCT"
          ? values.totalInventoryCount
          : undefined,
      limitConfiguration: purchaseLimitEnabled
        ? values.limitConfiguration
        : undefined,
      additionalEmailText: values.additionalEmailText || undefined,
      variants,
      ...(imageUploadResult && {
        requestingImageUpload: {
          mimeType: imageUploadResult.mimeType,
          contentMd5Hash: imageUploadResult.contentMd5Hash,
          fileSize: imageUploadResult.fileSize,
          width: imageUploadResult.width,
          height: imageUploadResult.height,
        },
      }),
    };

    setSaving(true);
    try {
      const response = await api.post<{
        success: boolean;
        productId: string;
        imageUploadPresignedUrl?: string;
      }>("/api/v1/store/admin/products", requestBody);

      if (imageUploadResult && response.data.imageUploadPresignedUrl) {
        const file = new File([imageUploadResult.blob], "product-image.jpg", {
          type: imageUploadResult.mimeType,
        });
        await uploadToS3PresignedUrl(
          response.data.imageUploadPresignedUrl,
          file,
          imageUploadResult.mimeType,
        );
      }

      notifications.show({
        title: "Product created",
        message: "The product was successfully created.",
        color: "green",
      });
      form.reset();
      setPurchaseLimitEnabled(false);
      setImageUploadResult(null);
      onProductCreated();
      onClose();
    } catch (e: any) {
      const message =
        e?.response?.data?.message ||
        e?.message ||
        "An unknown error occurred.";
      notifications.show({
        title: "Error creating product",
        message,
        color: "red",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (!saving) {
      form.reset();
      setPurchaseLimitEnabled(false);
      setImageUploadResult(null);
      onClose();
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Create Product"
      size="xl"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <Stack>
          {/* Section 1: Basic Info */}
          <TextInput
            label="Product ID"
            description="Unique ID, cannot be changed later (e.g., sp25-tshirt)"
            withAsterisk
            {...form.getInputProps("productId")}
          />
          <TextInput
            label="Name"
            withAsterisk
            {...form.getInputProps("name")}
          />
          <Textarea
            label="Description"
            autosize
            minRows={2}
            {...form.getInputProps("description")}
          />
          <ImageUpload
            onChange={setImageUploadResult}
            label="Product Image"
            disabled={saving}
          />

          {/* Section 2: Sales Window */}
          <Divider label="Sales Window" />
          <NonUrbanaTimezoneAlert />
          <UrbanaDateTimePicker
            label="Opens At"
            placeholder="Select date and time"
            value={form.values.openAt}
            onChange={(value) => form.setFieldValue("openAt", value)}
            error={form.errors.openAt}
            valueFormat="MM-DD-YYYY hh:mm A [CT]"
            clearable
          />
          <UrbanaDateTimePicker
            label="Closes At"
            placeholder="Select date and time"
            value={form.values.closeAt}
            onChange={(value) => form.setFieldValue("closeAt", value)}
            error={form.errors.closeAt}
            valueFormat="MM-DD-YYYY hh:mm A [CT]"
            clearable
          />

          {/* Section 3: Configuration */}
          <Divider label="Configuration" />
          <Switch
            label="Illinois NetID required to purchase?"
            description="NetID should be required unless there is some strongly compelling reason not to (such as having non-UIUC customers)."
            {...form.getInputProps("verifiedIdentityRequired", {
              type: "checkbox",
            })}
          />
          <TextInput
            label="Variant Friendly Name"
            description="The label used for a single variant (e.g., Size, Partner Organization)"
            {...form.getInputProps("variantFriendlyName")}
          />
          <Select
            label="Inventory Mode"
            description={`Usually, this is "Per Product" for tickets, and "Per Variant" for physical merchandise.`}
            data={[
              { value: "PER_VARIANT", label: "Per Variant" },
              { value: "PER_PRODUCT", label: "Per Product" },
            ]}
            {...form.getInputProps("inventoryMode")}
          />
          {form.values.inventoryMode === "PER_PRODUCT" && (
            <NumberInput
              label="Total Inventory Count"
              withAsterisk
              min={0}
              {...form.getInputProps("totalInventoryCount")}
            />
          )}
          <Switch
            label="Enable purchase limit"
            checked={purchaseLimitEnabled}
            onChange={(e) => {
              const checked = e.currentTarget.checked;
              setPurchaseLimitEnabled(checked);
              if (checked) {
                form.setFieldValue("limitConfiguration", {
                  limitType: "PER_PRODUCT",
                  maxQuantity: 1,
                });
              } else {
                form.setFieldValue("limitConfiguration", undefined);
              }
            }}
          />
          {purchaseLimitEnabled && (
            <>
              <Select
                label="Limit Type"
                data={[
                  { value: "PER_PRODUCT", label: "Per Product" },
                  { value: "PER_VARIANT", label: "Per Variant" },
                ]}
                {...form.getInputProps("limitConfiguration.limitType")}
              />
              <NumberInput
                label="Max Quantity"
                min={1}
                {...form.getInputProps("limitConfiguration.maxQuantity")}
              />
            </>
          )}
          <Textarea
            label="Additional Email Text"
            description="This text will be included in the confirmation email sent to the customer."
            minRows={2}
            {...form.getInputProps("additionalEmailText")}
          />

          {/* Section 4: Variants */}
          <Divider label="Variants" />
          <Button
            leftSection={<IconPlus size={14} />}
            variant="outline"
            onClick={() =>
              form.insertListItem("variants", { ...defaultVariant }, 0)
            }
          >
            Add Variant
          </Button>
          {form.values.variants.map((variant, index) => (
            <Paper key={index} withBorder p="md">
              <Stack>
                <Group justify="space-between">
                  <Text fw={500}>Variant {index + 1}</Text>
                  <ActionIcon
                    color="red"
                    variant="subtle"
                    disabled={form.values.variants.length <= 1}
                    onClick={() => form.removeListItem("variants", index)}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
                <TextInput
                  label="Name"
                  withAsterisk
                  {...form.getInputProps(`variants.${index}.name`)}
                />
                <Textarea
                  label="Description"
                  autosize
                  minRows={1}
                  {...form.getInputProps(`variants.${index}.description`)}
                />
                <TextInput
                  label="Image URL"
                  {...form.getInputProps(`variants.${index}.imageUrl`)}
                />
                <Group grow>
                  <NumberInput
                    label="Member Price"
                    prefix="$"
                    decimalScale={2}
                    fixedDecimalScale
                    min={0}
                    {...form.getInputProps(
                      `variants.${index}.memberPriceDollars`,
                    )}
                  />
                  <NumberInput
                    label="Non-Member Price"
                    prefix="$"
                    decimalScale={2}
                    fixedDecimalScale
                    min={0}
                    {...form.getInputProps(
                      `variants.${index}.nonmemberPriceDollars`,
                    )}
                  />
                </Group>
                {form.values.inventoryMode === "PER_VARIANT" && (
                  <>
                    {variant.inventoryCount != null && (
                      <NumberInput
                        label="Inventory Count"
                        min={1}
                        {...form.getInputProps(
                          `variants.${index}.inventoryCount`,
                        )}
                      />
                    )}
                    <Switch
                      label="Unlimited inventory"
                      checked={variant.inventoryCount == null}
                      onChange={(e) => {
                        form.setFieldValue(
                          `variants.${index}.inventoryCount`,
                          e.currentTarget.checked ? null : 0,
                        );
                      }}
                    />
                  </>
                )}
                <Switch
                  label="Exchanges allowed"
                  {...form.getInputProps(`variants.${index}.exchangesAllowed`, {
                    type: "checkbox",
                  })}
                />
                <TagsInput
                  label="Member Lists"
                  description="Users in these lists get member pricing"
                  {...form.getInputProps(`variants.${index}.memberLists`)}
                />
              </Stack>
            </Paper>
          ))}

          {/* Footer */}
          <Group justify="flex-end">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Create Product
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
};
