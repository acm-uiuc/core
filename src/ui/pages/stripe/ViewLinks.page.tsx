import React, { useState } from "react";
import { Card, Container, Divider, Title, Text } from "@mantine/core";
import { AuthGuard } from "@ui/components/AuthGuard";
import { AppRoles } from "@common/roles";
import StripeCurrentLinksPanel from "./CurrentLinks";
import StripeCreateLinkPanel from "./CreateLink";
import {
  GetInvoiceLinksResponse,
  PostInvoiceLinkRequest,
  PostInvoiceLinkResponse,
} from "@common/types/stripe";
import { useApi } from "@ui/util/api";

export const ManageStripeLinksPage: React.FC = () => {
  const api = useApi("core");

  const createLink = async (
    payload: PostInvoiceLinkRequest,
  ): Promise<PostInvoiceLinkResponse> => {
    const modifiedPayload = {
      ...payload,
      invoiceAmountUsd: payload.invoiceAmountUsd * 100,
    };
    const response = await api.post(
      "/api/v1/stripe/paymentLinks",
      modifiedPayload,
    );
    return response.data;
  };

  const getLinks = async (): Promise<GetInvoiceLinksResponse> => {
    const response = await api.get("/api/v1/stripe/paymentLinks");
    return response.data;
  };

  return (
    <AuthGuard
      resourceDef={{
        service: "core",
        validRoles: [AppRoles.STRIPE_LINK_CREATOR],
      }}
      showSidebar
    >
      <Container>
        <Title>Stripe Link Creator</Title>
        <Text>
          Create a Stripe Payment Link to accept credit card payments.
        </Text>
        <StripeCreateLinkPanel createLink={createLink} />
        <StripeCurrentLinksPanel getLinks={getLinks} />
      </Container>
    </AuthGuard>
  );
};
