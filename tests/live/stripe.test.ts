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
        { method: "POST" },
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
  const callbackUrl = "https://example.com/acm-core-live-test-callback";
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
        invoiceId,
        invoiceAmountUsd: 1000,
        contactName: "ACM Infra",
        contactEmail: "core-e2e-testing@acm.illinois.edu",
        achPaymentsEnabled: false,
        callbackUrl,
      }),
    });
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.link).toBeDefined();
    expect(body.id).toBeDefined();
    expect(body.signingSecret).toMatch(/^[a-f0-9]{64}$/);
    paymentLinkUrl = body.link;
    paymentLinkId = body.id;
  });
  test(
    "Test that http callback URLs are rejected",
    { timeout: 10000 },
    async () => {
      const response = await fetch(
        `${baseEndpoint}/api/v1/stripe/paymentLinks`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            invoiceId: `LiveTest-${randomUUID().split("-")[0]}`,
            invoiceAmountUsd: 1000,
            contactName: "ACM Infra",
            contactEmail: "core-e2e-testing@acm.illinois.edu",
            achPaymentsEnabled: false,
            callbackUrl: "http://example.com/acm-core-live-test-callback",
          }),
        },
      );
      expect(response.status).toBe(400);
    },
  );
  test(
    "Test that callbackUrl is exposed but signingSecret is not listed",
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
      const body = await response.json();
      const createdLink = body.find(
        (link: { id?: string }) => link.id === paymentLinkId,
      );
      expect(response.status).toBe(200);
      expect(createdLink).toBeDefined();
      expect(createdLink.callbackUrl).toBe(callbackUrl);
      expect(createdLink.signingSecret).toBeUndefined();
    },
  );
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
      if (!paymentLinkUrl || !paymentLinkId) {
        throw new Error("Payment link was not created.");
      }
      const response = await fetch(
        `${baseEndpoint}/api/v1/stripe/paymentLinks/${paymentLinkId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      expect(response.status).toBe(204);
    },
  );
});
