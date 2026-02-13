import React from "react";
import { Modal, Badge, Group, Text, Stack, Image, Alert } from "@mantine/core";
import { IconCheck, IconX, IconInfoCircle } from "@tabler/icons-react";
import type { Variant, LimitType } from "@common/types/store";
import { ResponsiveTable, Column } from "@ui/components/ResponsiveTable";

type VariantWithoutProductId = Omit<Variant, "productId">;

interface VariantsModalProps {
  opened: boolean;
  onClose: () => void;
  productName: string;
  variants: VariantWithoutProductId[];
  inventoryMode: LimitType;
  totalInventoryCount?: number | null;
  totalSoldCount?: number;
}

const formatCurrency = (cents: number): string => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
};

const getVariantInventoryBadge = (variant: VariantWithoutProductId) => {
  if (variant.inventoryCount === null || variant.inventoryCount === undefined) {
    return <Badge color="blue">Unlimited</Badge>;
  }

  const remaining = variant.inventoryCount;
  if (remaining <= 0) {
    return <Badge color="red">Sold Out</Badge>;
  }
  if (remaining <= 10) {
    return <Badge color="orange">Low Stock ({remaining})</Badge>;
  }
  return <Badge color="green">{remaining} available</Badge>;
};

const getProductInventoryBadge = (
  totalInventoryCount: number | null | undefined,
) => {
  if (totalInventoryCount === null || totalInventoryCount === undefined) {
    return <Badge color="blue">Unlimited</Badge>;
  }

  const remaining = totalInventoryCount;
  if (remaining <= 0) {
    return <Badge color="red">Sold Out</Badge>;
  }
  if (remaining <= 10) {
    return <Badge color="orange">Low Stock ({remaining})</Badge>;
  }
  return <Badge color="green">{remaining} available</Badge>;
};

export const VariantsModal: React.FC<VariantsModalProps> = ({
  opened,
  onClose,
  productName,
  variants,
  inventoryMode,
  totalInventoryCount,
  totalSoldCount = 0,
}) => {
  const productOriginalInventory =
    totalInventoryCount != null ? totalInventoryCount + totalSoldCount : null;

  const columns: Column<VariantWithoutProductId>[] = [
    {
      key: "name",
      label: "Variant",
      isPrimaryColumn: true,
      render: (variant) => (
        <Group gap="sm">
          {(variant as VariantWithoutProductId & { imageUrl?: string })
            .imageUrl && (
            <Image
              src={
                (variant as VariantWithoutProductId & { imageUrl?: string })
                  .imageUrl
              }
              alt={variant.name}
              w={36}
              h={36}
              radius="sm"
              fit="cover"
            />
          )}
          <Stack gap={0}>
            <Text size="sm">{variant.name}</Text>
            {variant.description && (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {variant.description}
              </Text>
            )}
          </Stack>
        </Group>
      ),
    },
    {
      key: "memberPrice",
      label: "Member Price",
      render: (variant) => formatCurrency(variant.memberPriceCents),
    },
    {
      key: "nonmemberPrice",
      label: "Non-Member Price",
      render: (variant) => formatCurrency(variant.nonmemberPriceCents),
    },
    ...(inventoryMode === "PER_VARIANT"
      ? [
          {
            key: "inventory",
            label: "Inventory",
            render: (variant: VariantWithoutProductId) =>
              getVariantInventoryBadge(variant),
          },
        ]
      : []),
    {
      key: "sold",
      label: "Sold",
      render: (variant) => {
        const originalInventory =
          variant.inventoryCount != null
            ? variant.inventoryCount + variant.soldCount
            : null;

        return (
          <Text size="sm">
            {variant.soldCount}
            {inventoryMode === "PER_VARIANT" && originalInventory != null && (
              <Text span size="sm" c="dimmed">
                {" "}
                / {originalInventory}
              </Text>
            )}
          </Text>
        );
      },
    },
    {
      key: "exchanges",
      label: "Exchanges",
      render: (variant) =>
        variant.exchangesAllowed ? (
          <IconCheck size={18} color="var(--mantine-color-green-6)" />
        ) : (
          <IconX size={18} color="var(--mantine-color-gray-5)" />
        ),
    },
  ];

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text>Variants for {productName}</Text>}
      size="xl"
    >
      <Stack gap="md">
        {inventoryMode === "PER_PRODUCT" && (
          <Alert icon={<IconInfoCircle size={16} />} color="blue">
            <Group justify="space-between">
              <Text size="sm">
                Inventory is tracked at the product level, not per variant.
              </Text>
              <Group gap="xs">
                <Text size="sm" fw={500}>
                  Product inventory:
                </Text>
                {getProductInventoryBadge(totalInventoryCount)}
                <Text size="sm" c="dimmed">
                  ({totalSoldCount}
                  {productOriginalInventory != null &&
                    ` of ${productOriginalInventory}`}{" "}
                  sold)
                </Text>
              </Group>
            </Group>
          </Alert>
        )}

        {variants.length === 0 ? (
          <Text c="dimmed" ta="center" py="md">
            No variants found for this product.
          </Text>
        ) : (
          <ResponsiveTable
            data={variants}
            columns={columns}
            keyExtractor={(variant) => variant.variantId}
            testIdPrefix="variant-row"
            testId="variants-table"
          />
        )}
      </Stack>
    </Modal>
  );
};
