import { expect, test, describe } from "vitest";
import { parseSQSPayload } from "../../../src/common/types/sqsMessage.js";
import { ZodError } from "zod/v4";

describe("SQS Message Parsing Tests", () => {
  test("Ping message parses correctly", () => {
    const payload = {
      metadata: {
        reqId: "12345",
        initiator: "unit-test",
      },
      function: "ping",
      payload: {},
    };
    const response = parseSQSPayload(payload);
    expect(response).toStrictEqual(payload);
  });
  test("Invalid function doesn't parse", () => {
    const payload = {
      metadata: {
        reqId: "12345",
        initiator: "unit-test",
      },
      function: "invalid_function",
      payload: {},
    };
    expect(parseSQSPayload(payload)).toBeInstanceOf(ZodError);
  });
  test("Stripe link subscriber callback message parses correctly", () => {
    const payload = {
      metadata: {
        reqId: "req_123",
        initiator: "evt_123",
      },
      function: "stripeLinkSubscriberCallback",
      payload: {
        linkId: "plink_123",
        eventType: "payment.succeeded",
        eventId: "evt_123",
        invoiceId: "INV-123",
        amount: 12345,
        currency: "usd",
        paidInFull: true,
        paymentMethod: null,
        payerName: null,
        payerEmail: "payer@example.com",
        occurredAt: "2026-05-13T12:00:00.000Z",
      },
    };
    const response = parseSQSPayload(payload);
    expect(response).toStrictEqual(payload);
  });
  test("Stripe link subscriber callback rejects unknown event types", () => {
    const payload = {
      metadata: {
        reqId: "req_123",
        initiator: "evt_123",
      },
      function: "stripeLinkSubscriberCallback",
      payload: {
        linkId: "plink_123",
        eventType: "invoice.paid",
        eventId: "evt_123",
        invoiceId: "INV-123",
        amount: 12345,
        currency: "usd",
        paidInFull: true,
        occurredAt: "2026-05-13T12:00:00.000Z",
      },
    };
    expect(parseSQSPayload(payload)).toBeInstanceOf(ZodError);
  });
});
