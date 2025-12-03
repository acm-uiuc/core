import React, { useState } from "react";
import { Card, Container, Divider, Title, Text } from "@mantine/core";
import { AuthGuard } from "@ui/components/AuthGuard";
import { AppRoles } from "@common/roles";
import { useApi } from "@ui/util/api";
import { OrgApiKeyTable } from "./ManageKeysTable";

export const ManageApiKeysPage: React.FC = () => {
  const api = useApi("core");

  return (
    <AuthGuard
      resourceDef={{
        service: "core",
        validRoles: [AppRoles.MANAGE_ORG_API_KEYS],
      }}
      showSidebar
    >
      <Container size="lg">
        <Title>API Keys</Title>
        <Text>Manage organization API keys.</Text>
        <Text size="xs" c="dimmed">
          These keys' permissions are not tied to any one user, and can be
          managed by organization admins.
        </Text>
        <Divider m="md" />
        <OrgApiKeyTable
          getApiKeys={() =>
            api.get("/api/v1/apiKey/org").then((res) => res.data)
          }
          deleteApiKeys={(ids) =>
            Promise.all(
              ids.map((id) => api.delete(`/api/v1/apiKey/org/${id}`)),
            ).then(() => {})
          }
          createApiKey={(data) =>
            api.post("/api/v1/apiKey/org", data).then((res) => res.data)
          }
        />
      </Container>
    </AuthGuard>
  );
};
