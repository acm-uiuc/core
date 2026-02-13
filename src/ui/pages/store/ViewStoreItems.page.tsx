import React, { useState } from "react";
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
import { IconPlus } from "@tabler/icons-react";
import { useDisclosure } from "@mantine/hooks";
import { CreateProductModal } from "./CreateProductModal";

export const ViewStoreItemsPage: React.FC = () => {
  const api = useApi("core");
  const navigate = useNavigate();
  const [
    createModalOpened,
    { open: openCreateModal, close: closeCreateModal },
  ] = useDisclosure(false);
  const [productTableKey, setProductTableKey] = useState(0);

  const getProducts = async () => {
    const response = await api.get<AdminListProductsResponse>(
      "/api/v1/store/admin/products",
    );
    return response.data.products;
  };
  const modifyProductMetadata = async (
    productId: string,
    data: ModifyProductRequest,
  ): Promise<{ imageUploadPresignedUrl?: string } | void> => {
    const response = await api.patch<{
      success: boolean;
      imageUploadPresignedUrl?: string;
    } | null>(`/api/v1/store/admin/products/${productId}`, data);
    if (response.status > 299) {
      throw new Error("Failed to modify product metadata");
    }
    return response.data ?? undefined;
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
              onClick={openCreateModal}
            >
              Create Product
            </Button>
          </div>
        </AuthGuard>
        <CreateProductModal
          opened={createModalOpened}
          onClose={closeCreateModal}
          onProductCreated={() => setProductTableKey((k) => k + 1)}
        />
        <ProductsTable
          key={productTableKey}
          getProducts={getProducts}
          modifyProductMetadata={modifyProductMetadata}
        />
      </Container>
    </AuthGuard>
  );
};
