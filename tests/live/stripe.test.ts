import { expect, test, describe } from "vitest";
import { createJwt, getBaseEndpoint } from "./utils.js";
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
  const callbackOrigin = new URL(callbackUrl).origin;
  let paymentLinkUrl: string | undefined;
  let paymentLinkId: string | undefined;

  const authedFetch = (path: string, init: RequestInit = {}) =>
    fetch(`${baseEndpoint}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        // Only when there is a body to describe: Fastify rejects an empty body
        // sent with a JSON content-type, which a bodiless DELETE would trip.
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });

  // Failures against a deployed environment are opaque without the body the
  // error handler sends back, so surface it in the assertion message.
  const expectStatus = async (response: Response, expected: number) => {
    if (response.status !== expected) {
      const detail = await response.text().catch(() => "<unreadable body>");
      expect.fail(`Expected ${expected} but got ${response.status}: ${detail}`);
    }
    expect(response.status).toBe(expected);
  };

  // Every field is a valid default; tests override only what they are about.
  const createPaymentLink = (overrides: Record<string, unknown> = {}) =>
    authedFetch("/api/v1/stripe/paymentLinks", {
      method: "POST",
      body: JSON.stringify({
        invoiceId: `LiveTest-${randomUUID().split("-")[0]}`,
        invoiceAmountUsd: 1000,
        contactName: "ACM Infra",
        contactEmail: "core-e2e-testing@acm.illinois.edu",
        achPaymentsEnabled: false,
        ...overrides,
      }),
    });

  test(
    "Test that registering a callback origin succeeds",
    { timeout: 10000 },
    async () => {
      const response = await authedFetch(
        "/api/v1/stripe/paymentLinks/callback",
        {
          method: "POST",
          body: JSON.stringify({
            callbackUrl,
            description: "ACM Core live test",
          }),
        },
      );
      await expectStatus(response, 201);
      const body = await response.json();
      expect(body.origin).toBe(callbackOrigin);
    },
  );
  test(
    "Test that unregistered callback origins are rejected",
    { timeout: 10000 },
    async () => {
      const response = await createPaymentLink({
        callbackUrl: "https://unregistered.example.org/callback",
      });
      expect(response.status).toBe(400);
    },
  );
  test("Test that creating a link succeeds", { timeout: 10000 }, async () => {
    const response = await createPaymentLink({ invoiceId, callbackUrl });
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
      const response = await createPaymentLink({
        callbackUrl: "http://example.com/acm-core-live-test-callback",
      });
      expect(response.status).toBe(400);
    },
  );
  test(
    "Test that callbackUrl is exposed but signingSecret is not listed",
    { timeout: 10000 },
    async () => {
      const response = await authedFetch("/api/v1/stripe/paymentLinks");
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
      const response = await authedFetch(
        `/api/v1/stripe/paymentLinks/${paymentLinkId}`,
        { method: "DELETE" },
      );
      await expectStatus(response, 204);
    },
  );
  test(
    "Test that deregistering the callback origin succeeds",
    { timeout: 10000 },
    async () => {
      const response = await authedFetch(
        `/api/v1/stripe/paymentLinks/callback/${encodeURIComponent(callbackOrigin)}`,
        { method: "DELETE" },
      );
      await expectStatus(response, 204);
    },
  );
  test(
    "Test that listing callback registrations no longer includes it",
    { timeout: 10000 },
    async () => {
      const response = await authedFetch(
        "/api/v1/stripe/paymentLinks/callback",
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(
        body.find(
          (entry: { origin?: string }) => entry.origin === callbackOrigin,
        ),
      ).toBeUndefined();
    },
  );
});
