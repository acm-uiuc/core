import React from "react";
import { Container, Title, Text } from "@mantine/core";
import { AuthGuard } from "@ui/components/AuthGuard";

// TODO: add funding request roles to validRoles once they exist in common/roles.ts.
// An empty list lets any logged-in user see the page.

export const ManageFundingRequestsPage: React.FC = () => {
  return (
    <AuthGuard resourceDef={{ service: "core", validRoles: [] }} showSidebar>
      <Container>
        <Title>Funding Requests</Title>
        {/* TODO: semester selector + table of funding requests (GET /api/v1/fundingRequests) */}
        <Text c="dimmed" mt="sm">
          Funding requests will show up here.
        </Text>
      </Container>
    </AuthGuard>
  );
};
