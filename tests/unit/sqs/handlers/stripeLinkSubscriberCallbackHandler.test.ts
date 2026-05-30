import { beforeEach, describe, expect, test, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { genericConfig } from "../../../../src/common/config.js";

vi.mock("../../../../src/api/functions/subscriberCallback.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/api/functions/subscriberCallback.js")
  >("../../../../src/api/functions/subscriberCallback.js");
  return {
    ...actual,
    deliverSubscriberCallback: vi.fn(),
  };
});

import {
  deliverSubscriberCallback,
  SubscriberCallbackBlockedError,
} from "../../../../src/api/functions/subscriberCallback.js";
import { stripeLinkSubscriberCallbackHandler } from "../../../../src/api/sqs/handlers/stripeLinkSubscriberCallbackHandler.js";

const ddbMock = mockClient(DynamoDBClient);
const deliverSubscriberCallbackMock = vi.mocked(deliverSubscriberCallback);

describe("stripeLinkSubscriberCallbackHandler", () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const metadata = { reqId: "req_123", initiator: "evt_123" };
  const payload = {
    linkId: "plink_123",
    eventType: "payment.succeeded" as const,
    eventId: "evt_123",
    invoiceId: "INV-123",
    amount: 12345,
    currency: "usd",
    paidInFull: true,
    paymentMethod: "Credit/Debit Card (Visa ending in 4242)",
    payerName: undefined,
    payerEmail: "payer@example.com",
    occurredAt: "2026-05-13T12:00:00.000Z",
  };

  beforeEach(() => {
    ddbMock.reset();
    vi.clearAllMocks();
  });

  test("looks up the link and delivers the subscriber callback", async () => {
    ddbMock.on(QueryCommand).resolvesOnce({
      Items: [
        marshall({
          callbackUrl: "https://callbacks.example.com/stripe",
          signingSecret: "secret_123",
        }),
      ],
    });

    await stripeLinkSubscriberCallbackHandler(payload, metadata, logger as any);

    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(1);
    expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input).toStrictEqual({
      TableName: genericConfig.StripeLinksDynamoTableName,
      IndexName: "LinkIdIndex",
      KeyConditionExpression: "linkId = :linkId",
      ExpressionAttributeValues: {
        ":linkId": { S: "plink_123" },
      },
    });
    expect(deliverSubscriberCallbackMock).toHaveBeenCalledExactlyOnceWith({
      callbackUrl: "https://callbacks.example.com/stripe",
      signingSecret: "secret_123",
      eventId: "evt_123",
      body: {
        type: "payment.succeeded",
        eventId: "evt_123",
        linkId: "plink_123",
        invoiceId: "INV-123",
        amount: 12345,
        currency: "usd",
        paidInFull: true,
        paymentMethod: "Credit/Debit Card (Visa ending in 4242)",
        payerName: null,
        payerEmail: "payer@example.com",
        occurredAt: "2026-05-13T12:00:00.000Z",
      },
      logger,
    });
  });

  test("drops the message when the link is missing", async () => {
    ddbMock.on(QueryCommand).resolvesOnce({ Items: [] });

    await stripeLinkSubscriberCallbackHandler(payload, metadata, logger as any);

    expect(deliverSubscriberCallbackMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { linkId: "plink_123" },
      "Stripe link not found for subscriber callback; dropping message.",
    );
  });

  test("drops the message when callbacks are disabled before delivery", async () => {
    ddbMock.on(QueryCommand).resolvesOnce({
      Items: [
        marshall({ callbackUrl: "https://callbacks.example.com/stripe" }),
      ],
    });

    await stripeLinkSubscriberCallbackHandler(payload, metadata, logger as any);

    expect(deliverSubscriberCallbackMock).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      { linkId: "plink_123" },
      "Stripe link has no callbackUrl/signingSecret; dropping message.",
    );
  });

  test("drops blocked callback URLs without retrying", async () => {
    ddbMock.on(QueryCommand).resolvesOnce({
      Items: [
        marshall({
          callbackUrl: "https://10.0.0.1/stripe",
          signingSecret: "secret_123",
        }),
      ],
    });
    deliverSubscriberCallbackMock.mockRejectedValueOnce(
      new SubscriberCallbackBlockedError("blocked"),
    );

    await stripeLinkSubscriberCallbackHandler(payload, metadata, logger as any);

    expect(logger.error).toHaveBeenCalledWith(
      { error: "blocked", linkId: "plink_123" },
      "Subscriber callback blocked; dropping (not retrying).",
    );
  });

  test("bubbles delivery failures so SQS retries", async () => {
    ddbMock.on(QueryCommand).resolvesOnce({
      Items: [
        marshall({
          callbackUrl: "https://callbacks.example.com/stripe",
          signingSecret: "secret_123",
        }),
      ],
    });
    deliverSubscriberCallbackMock.mockRejectedValueOnce(new Error("retry me"));

    await expect(
      stripeLinkSubscriberCallbackHandler(payload, metadata, logger as any),
    ).rejects.toThrow("retry me");
  });
});
