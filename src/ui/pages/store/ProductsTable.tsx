import React, { useEffect, useState } from "react";
import {
  Text,
  Button,
  ButtonGroup,
  Badge,
  Modal,
  Group,
  TextInput,
  Textarea,
  Switch,
  Stack,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconEdit } from "@tabler/icons-react";
import {
  AdminListProductsResponse,
  ModifyProductRequest,
  modifyProductSchema,
  Variant,
} from "@common/types/store";
import { ResponsiveTable, Column } from "@ui/components/ResponsiveTable";
import FullScreenLoader from "@ui/components/AuthContext/LoadingScreen";
import { zod4Resolver as zodResolver } from "mantine-form-zod-resolver";
import {
  formatChicagoTime,
  UrbanaDateTimePicker,
} from "@ui/components/UrbanaDateTimePicker";
import { NonUrbanaTimezoneAlert } from "@ui/components/NonUrbanaTimezoneAlert";
import { AppRoles } from "@common/roles";
import { AuthGuard } from "@ui/components/AuthGuard";
import { VariantsModal } from "./VariantsModal";

interface ProductsTableProps {
  getProducts: () => Promise<AdminListProductsResponse["products"]>;
  modifyProductMetadata: (
    productId: string,
    data: ModifyProductRequest,
  ) => Promise<void>;
}

type Product = AdminListProductsResponse["products"][number];

const formSchema = modifyProductSchema.refine(
  (data) => {
    if (data.openAt != null && data.closeAt != null) {
      return data.closeAt > data.openAt;
    }
    return true;
  },
  {
    message: "Close date must be after open date",
    path: ["closeAt"],
  },
);

export const ProductsTable: React.FC<ProductsTableProps> = ({
  getProducts,
  modifyProductMetadata,
}) => {
  const [products, setProducts] = useState<
    AdminListProductsResponse["products"] | null | undefined
  >(undefined);
  const [editCandidate, setEditCandidate] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);
  const [opened, { open, close }] = useDisclosure(false);

  // Variants modal state
  const [
    variantsModalOpened,
    { open: openVariantsModal, close: closeVariantsModal },
  ] = useDisclosure(false);
  const [selectedProductForVariants, setSelectedProductForVariants] =
    useState<Product | null>(null);

  const form = useForm<ModifyProductRequest>({
    mode: "controlled",
    validate: zodResolver(formSchema),
    initialValues: {},
  });

  const fetchProducts = async () => {
    try {
      setProducts(undefined);
      const fetchedProducts = await getProducts();
      setProducts(fetchedProducts);
    } catch (e) {
      console.error(e);
      setProducts(null);
      notifications.show({
        title: "Error fetching products",
        message: `${e}`,
        color: "red",
      });
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const handleEdit = (product: Product) => {
    setEditCandidate(product);
    form.setInitialValues(product);
    form.reset();
    open();
  };

  const handleViewVariants = (product: Product) => {
    setSelectedProductForVariants(product);
    openVariantsModal();
  };

  const handleSave = async () => {
    if (!editCandidate) {
      return;
    }

    const validation = form.validate();
    if (validation.hasErrors) {
      return;
    }

    const dirtyFields = Object.fromEntries(
      Object.entries(form.values).filter(([key]) =>
        form.isDirty(key as keyof ModifyProductRequest),
      ),
    ) as ModifyProductRequest;

    if (Object.keys(dirtyFields).length === 0) {
      return;
    }

    setSaving(true);
    try {
      await modifyProductMetadata(editCandidate.productId, dirtyFields);
      notifications.show({
        title: "Product updated",
        message: "The product was successfully updated.",
        color: "green",
      });
      handleCloseModal();
      await fetchProducts();
    } catch (e) {
      console.error(e);
      notifications.show({
        title: "Error updating product",
        message: `${e}`,
        color: "red",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCloseModal = () => {
    setEditCandidate(null);
    form.reset();
    close();
  };

  const formatPrice = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const formatPriceRange = (prices: number[]) => {
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    if (minPrice === maxPrice) {
      return formatPrice(minPrice);
    }
    return `${formatPrice(minPrice)} – ${formatPrice(maxPrice)}`;
  };

  const getStatusBadge = (product: Product) => {
    if (product.isOpen) {
      return <Badge color="green">Open</Badge>;
    }
    const now = Date.now();
    if (product.openAt && product.openAt * 1000 > now) {
      return <Badge color="blue">Scheduled</Badge>;
    }
    return <Badge color="gray">Closed</Badge>;
  };

  const columns: Column<Product>[] = [
    {
      key: "name",
      label: "Product",
      isPrimaryColumn: true,
      render: (product) => (
        <>
          {product.name} {getStatusBadge(product)}
        </>
      ),
    },
    {
      key: "variants",
      label: "Variants",
      render: (product) => (
        <Badge
          style={{ cursor: "pointer" }}
          onClick={(e) => {
            e.stopPropagation();
            handleViewVariants(product);
          }}
        >
          {product.variants.length} variant
          {product.variants.length !== 1 ? "s" : ""}
        </Badge>
      ),
    },
    {
      key: "memberPrice",
      label: "Member Price",
      render: (product) => {
        if (product.variants.length === 0) {
          return "—";
        }
        const prices = product.variants.map((v) => v.memberPriceCents);
        return formatPriceRange(prices);
      },
    },
    {
      key: "nonmemberPrice",
      label: "Non-Member Price",
      render: (product) => {
        if (product.variants.length === 0) {
          return "—";
        }
        const prices = product.variants.map((v) => v.nonmemberPriceCents);
        return formatPriceRange(prices);
      },
    },
    {
      key: "openAt",
      label: "Opens",
      render: (product) => formatChicagoTime(product.openAt),
    },
    {
      key: "closeAt",
      label: "Closes",
      render: (product) => formatChicagoTime(product.closeAt),
    },
    {
      key: "actions",
      label: "Actions",
      hideMobileLabel: true,
      render: (product) => (
        <AuthGuard
          resourceDef={{
            service: "core",
            validRoles: [AppRoles.STORE_MANAGER],
          }}
          isAppShell={false}
        >
          <ButtonGroup>
            <Button
              leftSection={<IconEdit size={14} />}
              onClick={(e) => {
                e.stopPropagation();
                handleEdit(product);
              }}
            >
              Edit
            </Button>
          </ButtonGroup>
        </AuthGuard>
      ),
    },
  ];

  if (products === undefined) {
    return <FullScreenLoader />;
  }

  if (products === null) {
    return (
      <Text c="red" ta="center">
        Failed to load products. Please try again.
      </Text>
    );
  }

  return (
    <>
      <Modal
        opened={opened}
        onClose={handleCloseModal}
        title={`Edit Product: ${editCandidate?.name}`}
        size="lg"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
        >
          <Stack>
            <NonUrbanaTimezoneAlert />
            <TextInput label="Name" {...form.getInputProps("name")} />
            <Textarea
              label="Description"
              minRows={3}
              maxRows={20}
              autosize
              {...form.getInputProps("description")}
            />
            <TextInput label="Image URL" {...form.getInputProps("imageUrl")} />
            <TextInput
              label="Variant Friendly Name"
              description="The label used for a single variant (e.g., Size, Partner Organization)"
              {...form.getInputProps("variantFriendlyName")}
            />
            <UrbanaDateTimePicker
              label="Opens At"
              placeholder="Select date and time"
              value={form.values.openAt}
              onChange={(value) => form.setFieldValue("openAt", value)}
              error={form.errors.openAt}
              valueFormat="MM-DD-YYYY hh:mm A [CT]"
              mt="sm"
              clearable={false}
            />
            <UrbanaDateTimePicker
              label="Closes At"
              placeholder="Select date and time"
              value={form.values.closeAt}
              onChange={(value) => form.setFieldValue("closeAt", value)}
              error={form.errors.closeAt}
              valueFormat="MM-DD-YYYY hh:mm A [CT]"
              mt="sm"
              clearable={false}
            />
            <Switch
              label="Illinois NetID required to purchase?"
              {...form.getInputProps("verifiedIdentityRequired", {
                type: "checkbox",
              })}
            />
            <Textarea
              label="Additional Email Text"
              description="This text will be included in the confirmation email sent to the customer."
              minRows={2}
              {...form.getInputProps("additionalEmailText")}
            />
            <Group justify="flex-end">
              <Button variant="outline" onClick={handleCloseModal}>
                Cancel
              </Button>
              <Button type="submit" loading={saving} disabled={!form.isDirty()}>
                Save Changes
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <VariantsModal
        opened={variantsModalOpened}
        onClose={closeVariantsModal}
        productName={selectedProductForVariants?.name ?? ""}
        variants={selectedProductForVariants?.variants ?? []}
        inventoryMode={
          selectedProductForVariants?.inventoryMode ?? "PER_VARIANT"
        }
        totalInventoryCount={selectedProductForVariants?.totalInventoryCount}
        totalSoldCount={selectedProductForVariants?.totalSoldCount}
      />

      <ResponsiveTable
        data={products}
        columns={columns}
        keyExtractor={(product) => product.productId}
        testIdPrefix="product-row"
        testId="products-table"
      />
    </>
  );
};
