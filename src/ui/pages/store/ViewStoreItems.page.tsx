import React from "react";
import { Container, Title, Text, Button } from "@mantine/core";
import { AuthGuard } from "@ui/components/AuthGuard";
import { AppRoles } from "@common/roles";
import {
  type AdminListProductsResponse,
  type ModifyProductRequest,
} from "@common/types/store";
import { useApi } from "@ui/util/api";
import { ProductsTable } from "./ProductsTable";
import { useNavigate } from "react-router-dom";
import { IconAlertCircle, IconPlus } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";

export const ViewStoreItemsPage: React.FC = () => {
  const api = useApi("core");
  const navigate = useNavigate();
  const getProducts = async () => {
    const response = await api.get<AdminListProductsResponse>(
      "/api/v1/store/admin/products",
    );
    return response.data.products;
  };
  const modifyProductMetadata = async (
    productId: string,
    data: ModifyProductRequest,
  ) => {
    const response = await api.patch<null>(
      `/api/v1/store/admin/products/${productId}`,
      data,
    );
    if (response.status > 299) {
      throw new Error("Failed to modify product metadata");
    }
  };
  return (
    <AuthGuard
      resourceDef={{
        service: "core",
        validRoles: [AppRoles.STORE_MANAGER, AppRoles.STORE_FULFILLMENT],
      }}
      showSidebar
    >
      <Container fluid>
        <Title>Store</Title>
        <Text size="sm" c="dimmed">
          View and manage store items
        </Text>
        <AuthGuard
          resourceDef={{
            service: "core",
            validRoles: [AppRoles.STORE_MANAGER],
          }}
          isAppShell={false}
        >
          <div
            style={{
              display: "flex",
              columnGap: "1vw",
              verticalAlign: "middle",
            }}
          >
            <Button
              leftSection={<IconPlus size={14} />}
              onClick={() => {
                // navigate("/events/add");
                notifications.show({
                  title: "Coming soon",
                  message: "Feature coming soon!",
                  color: "yellow",
                  icon: <IconAlertCircle size={16} />,
                });
              }}
            >
              Create Product
            </Button>
          </div>
        </AuthGuard>
        <ProductsTable
          getProducts={getProducts}
          modifyProductMetadata={modifyProductMetadata}
        />
      </Container>
    </AuthGuard>
  );
};
