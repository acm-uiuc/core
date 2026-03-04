import { expect, test, describe } from "vitest";
import { createJwt } from "./utils.js";
import { getBaseEndpoint } from "./utils.js";
import { randomUUID } from "node:crypto";

const baseEndpoint = getBaseEndpoint();
const token = await createJwt();

describe("Stripe live API authentication", async () => {
  test(
    "Test that auth is present on the GET route",
    { timeout: 10000 },
    async () => {
      const response = await fetch(
        `${baseEndpoint}/api/v1/stripe/paymentLinks`,
        { method: "GET" },
      );
      expect(response.status).toBe(401);
    },
  );
  test(
    "Test that auth is present on the POST route",
    { timeout: 10000 },
    async () => {
      const response = await fetch(
        `${baseEndpoint}/api/v1/stripe/paymentLinks`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            acmOrg: "C01",
            invoiceId: "AuthTest",
            invoiceAmountUsd: 1000,
            contactName: "ACM Infra",
            contactEmail: "core-e2e-testing@acm.illinois.edu",
          }),
        },
      );
      expect(response.status).toBe(401);
    },
  );
  test(
    "Test that getting existing links succeeds",
    { timeout: 10000 },
    async () => {
      const response = await fetch(
        `${baseEndpoint}/api/v1/stripe/paymentLinks`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      expect(response.status).toBe(200);
    },
  );
});

describe("Stripe link lifecycle test", { sequential: true }, async () => {
  const invoiceId = `LiveTest-${randomUUID().split("-")[0]}`;
  let paymentLinkUrl: string | undefined;
  let paymentLinkId: string | undefined;
  test("Test that creating a link succeeds", { timeout: 10000 }, async () => {
    const response = await fetch(`${baseEndpoint}/api/v1/stripe/paymentLinks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        acmOrg: "C01", // <-- ADD THIS (required)
        invoiceId,
        invoiceAmountUsd: 1000,
        contactName: "ACM Infra",
        contactEmail: "core-e2e-testing@acm.illinois.edu",
        // remove achPaymentsEnabled unless your schema includes it
      }),
    });

    const body = await response.json();
    console.log("POST body:", JSON.stringify(body));
    expect(response.status).toBe(201);

    // your API returns { id: invoiceId, link: `${PaymentBaseUrl}/${token}` }
    paymentLinkUrl = body.link;
    paymentLinkId = body.id; // NOTE: this is invoiceId, not a Stripe link id
  });

  test(
    "Test that accessing a created link succeeds",
    { timeout: 10000 },
    async () => {
      if (!paymentLinkUrl || !paymentLinkId) {
        throw new Error("Payment link was not created.");
      }
      const response = await fetch(paymentLinkUrl, {
        method: "GET",
      });
      expect(response.status).toBe(200);
    },
  );
  test(
    "Test that deleting a created link succeeds",
    { timeout: 10000 },
    async () => {
      if (!paymentLinkUrl) {
        throw new Error("Payment link was not created.");
      }

      // 1) List links to find the actual linkId (plink_...) for our invoiceId
      const listRes = await fetch(
        `${baseEndpoint}/api/v1/stripe/paymentLinks`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      expect(listRes.status).toBe(200);

      const links = await listRes.json();
      const match = links.find((l: any) => l.invoiceId === invoiceId);

      if (!match?.id) {
        throw new Error(`Created link not found for invoiceId=${invoiceId}`);
      }

      // 2) Delete using the real link id
      const delRes = await fetch(
        `${baseEndpoint}/api/v1/stripe/paymentLinks/${match.id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      expect(delRes.status).toBe(204);
    },
  );
});
