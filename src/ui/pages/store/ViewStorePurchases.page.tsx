import { AppRoles } from "@common/roles";
import {
  type GetProductResponse,
  type LineItem,
  type ListOrdersResponse,
} from "@common/types/store";
import {
  Container,
  Title,
  Text,
  Loader,
  Group,
  TextInput,
  Select,
  Badge,
  Stack,
  Button,
  Modal,
  Checkbox,
  Alert,
  Textarea,
} from "@mantine/core";
import { useDebouncedValue, useDisclosure } from "@mantine/hooks";
import { VariantsModal } from "./VariantsModal";
import { notifications } from "@mantine/notifications";
import { IconChartBar, IconEye, IconSearch } from "@tabler/icons-react";
import FullScreenLoader from "@ui/components/AuthContext/LoadingScreen";
import { AuthGuard } from "@ui/components/AuthGuard";
import { NameOptionalUserCard } from "@ui/components/NameOptionalCard";
import {
  ResponsiveTable,
  Column,
  useTableSort,
} from "@ui/components/ResponsiveTable";
import { formatChicagoTime } from "@ui/components/UrbanaDateTimePicker";
import { generateErrorMessage, useApi } from "@ui/util/api";
import { AxiosError } from "axios";
import React, { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";

interface ViewStorePurchasesPageProps {
  getProductPurchases: (productId: string) => Promise<ListOrdersResponse>;
  getProductInformation: (productId: string) => Promise<GetProductResponse>;
  refundOrder: (
    orderId: string,
    releaseInventory: boolean,
    justification: string,
  ) => Promise<void>;
  productId: string;
}

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "PENDING", label: "Pending" },
  { value: "CAPTURING", label: "Capturing" },
  { value: "REFUNDED", label: "Refunded" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "__ALL__", label: "All Statuses" },
];

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "green",
  PENDING: "yellow",
  CAPTURING: "blue",
  REFUNDED: "red",
  CANCELLED: "gray",
};

export const ViewStorePurchasesInternalPage: React.FC<
  ViewStorePurchasesPageProps
> = ({
  productId,
  getProductPurchases,
  getProductInformation,
  refundOrder,
}) => {
  const [productInfo, setProductInfo] = useState<
    GetProductResponse | undefined
  >(undefined);
  const [productSales, setProductSales] = useState<
    ListOrdersResponse | undefined
  >(undefined);
  const [userIdFilter, setUserIdFilter] = useState("");
  const [debouncedUserIdFilter] = useDebouncedValue(userIdFilter, 150);
  const [statusFilter, setStatusFilter] = useState<string>("ACTIVE");
  const { sortBy, reversedSort, handleSort, sortData } = useTableSort<LineItem>(
    "createdAt",
    true,
  );
  const navigate = useNavigate();
  const [refundCandidate, setRefundCandidate] = useState<LineItem | null>(null);
  const [refundConfirmEmail, setRefundConfirmEmail] = useState("");
  const [releaseInventory, setReleaseInventory] = useState(true);
  const [justification, setJustification] = useState("");
  const [refunding, setRefunding] = useState(false);
  const [
    refundModalOpened,
    { open: openRefundModal, close: closeRefundModal },
  ] = useDisclosure(false);
  const [
    variantsModalOpened,
    { open: openVariantsModal, close: closeVariantsModal },
  ] = useDisclosure(false);

  const handleRefundClick = (item: LineItem) => {
    setRefundCandidate(item);
    setRefundConfirmEmail("");
    setReleaseInventory(true);
    setJustification("");
    openRefundModal();
  };

  const handleRefundConfirm = async () => {
    if (!refundCandidate) {
      return;
    }
    setRefunding(true);
    try {
      await refundOrder(
        refundCandidate.orderId,
        releaseInventory,
        justification,
      );
      notifications.show({
        title: "Refund issued",
        message: `Order has been refunded.`,
        color: "green",
      });
      closeRefundModal();
      setRefundCandidate(null);
      setProductSales(await getProductPurchases(productId));
    } catch (e) {
      await generateErrorMessage(e, "issuing refund");
    } finally {
      setRefunding(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        setProductInfo(await getProductInformation(productId));
      } catch (e) {
        if (e instanceof AxiosError && e.status === 404) {
          await navigate("/store");
        } else {
          await generateErrorMessage(e, "fetching product information");
        }
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setProductSales(await getProductPurchases(productId));
      } catch (e) {
        if (e instanceof AxiosError && e.status === 404) {
          await navigate("/store");
        } else {
          await generateErrorMessage(e, "fetching product sales");
        }
      }
    })();
  }, []);

  const variantNameMap = useMemo(() => {
    if (!productInfo) {
      return new Map<string, string>();
    }
    const map = new Map<string, string>();
    for (const v of productInfo.variants) {
      map.set(v.variantId, v.name);
    }
    return map;
  }, [productInfo]);

  const filteredData = useMemo(() => {
    if (!productSales) {
      return [];
    }
    let items = productSales.items;

    if (statusFilter && statusFilter !== "__ALL__") {
      items = items.filter((item) => item.status === statusFilter);
    }

    if (debouncedUserIdFilter.trim()) {
      const filter = debouncedUserIdFilter.trim().toLowerCase();
      items = items.filter(
        (item) => item.userId && item.userId.toLowerCase().includes(filter),
      );
    }

    return items;
  }, [productSales, statusFilter, debouncedUserIdFilter]);

  const sortedData = useMemo(() => {
    return sortData(filteredData, (a, b, field) => {
      switch (field) {
        case "userId":
          return (a.userId ?? "").localeCompare(b.userId ?? "");
        case "variantId":
          return (variantNameMap.get(a.variantId) ?? a.variantId).localeCompare(
            variantNameMap.get(b.variantId) ?? b.variantId,
          );
        case "quantity":
          return a.quantity - b.quantity;
        case "createdAt":
          return a.createdAt - b.createdAt;
        case "status":
          return (a.status ?? "").localeCompare(b.status ?? "");
        case "isFulfilled":
          return Number(a.isFulfilled) - Number(b.isFulfilled);
        default:
          return 0;
      }
    });
  }, [filteredData, sortBy, reversedSort, variantNameMap]);

  const columns: Column<LineItem>[] = [
    {
      key: "userId",
      label: "Customer",
      sortable: true,
      isPrimaryColumn: true,
      render: (item) =>
        item.userId ? (
          <NameOptionalUserCard email={item.userId} size="sm" />
        ) : (
          <Text size="sm">—</Text>
        ),
    },
    {
      key: "variantId",
      label: productInfo?.variantFriendlyName || "Size",
      sortable: true,
      render: (item) => (
        <Text size="sm">
          {variantNameMap.get(item.variantId) ?? item.variantId}
        </Text>
      ),
    },
    {
      key: "quantity",
      label: "Quantity",
      sortable: true,
      render: (item) => <Text size="sm">{item.quantity}</Text>,
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (item) => (
        <Badge color={STATUS_COLORS[item.status ?? ""] ?? "gray"} size="sm">
          {item.status ?? "—"}
        </Badge>
      ),
    },
    {
      key: "isFulfilled",
      label: "Fulfilled",
      sortable: true,
      render: (item) => (
        <Badge color={item.isFulfilled ? "green" : "orange"} size="sm">
          {item.isFulfilled ? "Yes" : "No"}
        </Badge>
      ),
    },
    {
      key: "createdAt",
      label: "Created",
      sortable: true,
      render: (item) => (
        <Text size="sm">{formatChicagoTime(item.createdAt)}</Text>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      hideMobileLabel: true,
      render: (item) =>
        item.status === "ACTIVE" ? (
          <AuthGuard
            resourceDef={{
              service: "core",
              validRoles: [AppRoles.STORE_MANAGER],
            }}
            isAppShell={false}
          >
            <Button
              size="xs"
              color="red"
              variant="light"
              onClick={(e) => {
                e.stopPropagation();
                handleRefundClick(item);
              }}
            >
              Refund
            </Button>
          </AuthGuard>
        ) : null,
    },
  ];

  if (!productInfo) {
    return <FullScreenLoader />;
  }

  return (
    <AuthGuard
      resourceDef={{
        service: "core",
        validRoles: [AppRoles.STORE_MANAGER],
      }}
      showSidebar
    >
      <Container fluid>
        <Stack gap="md">
          <Title>Sales for {productInfo.name}</Title>
          <Button
            leftSection={<IconChartBar size={14} />}
            onClick={openVariantsModal}
            style={{ alignSelf: "flex-start" }}
          >
            View Variants / Inventory
          </Button>
          {!productSales && <Loader />}
          {productSales && (
            <>
              <Group grow preventGrowOverflow>
                <TextInput
                  placeholder="Filter by user email..."
                  leftSection={<IconSearch size={16} />}
                  value={userIdFilter}
                  onChange={(e) => setUserIdFilter(e.currentTarget.value)}
                />
                <Select
                  data={STATUS_OPTIONS}
                  value={statusFilter}
                  onChange={(v) => setStatusFilter(v ?? "ACTIVE")}
                  allowDeselect={false}
                  data-testid="status-filter"
                />
              </Group>
              <Text size="sm" c="dimmed">
                Showing {sortedData.length} of {productSales.items.length} line
                items
              </Text>
              {sortedData.length === 0 ? (
                <Text ta="center" c="dimmed" py="xl">
                  No orders match the current filters.
                </Text>
              ) : (
                <ResponsiveTable
                  data={sortedData}
                  columns={columns}
                  keyExtractor={(item) => item.lineItemId}
                  onSort={handleSort}
                  sortBy={sortBy}
                  sortReversed={reversedSort}
                  testId="sales-table"
                  testIdPrefix="sale-row"
                />
              )}
            </>
          )}
        </Stack>
        <VariantsModal
          opened={variantsModalOpened}
          onClose={closeVariantsModal}
          productName={productInfo.name}
          variants={productInfo.variants}
          inventoryMode={productInfo.inventoryMode}
          totalInventoryCount={productInfo.totalInventoryCount}
          totalSoldCount={productInfo.totalSoldCount}
        />
        <Modal
          opened={refundModalOpened}
          onClose={closeRefundModal}
          title="Confirm Refund"
        >
          <Stack>
            <Text size="sm">You are about to issue the following refund:</Text>
            <Alert icon={<IconEye size={16} />} color="yellow" variant="light">
              <Text size="sm">
                Refunds are permanent and will be recorded in the audit log
                along with your identity.
              </Text>
            </Alert>
            {refundCandidate?.userId && (
              <NameOptionalUserCard email={refundCandidate.userId} size="sm" />
            )}
            <Stack gap={4} pl="md">
              <Text size="sm">
                <Text span fw={600}>
                  Product:
                </Text>{" "}
                {productInfo?.name ?? refundCandidate?.productId}
              </Text>
              <Text size="sm">
                <Text span fw={600}>
                  {productInfo?.variantFriendlyName || "Variant"}:
                </Text>{" "}
                {variantNameMap.get(refundCandidate?.variantId ?? "") ??
                  refundCandidate?.variantId}
              </Text>
              <Text size="sm">
                <Text span fw={600}>
                  Quantity:
                </Text>{" "}
                {refundCandidate?.quantity}
              </Text>
            </Stack>
            <Text size="sm">
              To confirm, type the user's email address below:
            </Text>
            <TextInput
              placeholder={refundCandidate?.userId ?? ""}
              value={refundConfirmEmail}
              onChange={(e) => setRefundConfirmEmail(e.currentTarget.value)}
            />
            <Textarea
              label="Justification"
              description="Briefly explain why this refund is being issued (min 10 characters)."
              placeholder="e.g. Customer requested cancellation before fulfillment"
              minRows={2}
              autosize
              value={justification}
              onChange={(e) => setJustification(e.currentTarget.value)}
              withAsterisk
            />
            <Checkbox
              label="Release inventory back to the product"
              description="Uncheck this if the customer is keeping the item (e.g. a goodwill refund). Check this if the item is being returned and should be available for resale."
              checked={releaseInventory}
              onChange={(e) => setReleaseInventory(e.currentTarget.checked)}
            />
            <Group justify="flex-end">
              <Button variant="outline" onClick={closeRefundModal}>
                Cancel
              </Button>
              <Button
                color="red"
                loading={refunding}
                disabled={
                  refundConfirmEmail !== refundCandidate?.userId ||
                  justification.trim().length < 10
                }
                onClick={handleRefundConfirm}
              >
                Issue Refund
              </Button>
            </Group>
          </Stack>
        </Modal>
      </Container>
    </AuthGuard>
  );
};

export const ViewStorePurchasesPage: React.FC = () => {
  const { productId } = useParams();
  const api = useApi("core");
  if (!productId) {
    return <Navigate to="/store" replace />;
  }

  const getProductPurchases = async (productId: string) => {
    const response = await api.get<ListOrdersResponse>(
      `/api/v1/store/admin/orders/${productId}`,
    );
    return response.data as ListOrdersResponse;
  };
  const getProductInformation = async (productId: string) => {
    const response = await api.get<GetProductResponse>(
      `/api/v1/store/admin/products/${productId}`,
    );
    return response.data as GetProductResponse;
  };
  const refundOrderFn = async (
    orderId: string,
    releaseInventory: boolean,
    justification: string,
  ) => {
    await api.post(`/api/v1/store/admin/orders/${orderId}/refund`, {
      releaseInventory,
      justification,
    });
  };
  return (
    <ViewStorePurchasesInternalPage
      productId={productId}
      getProductPurchases={getProductPurchases}
      getProductInformation={getProductInformation}
      refundOrder={refundOrderFn}
    />
  );
};
