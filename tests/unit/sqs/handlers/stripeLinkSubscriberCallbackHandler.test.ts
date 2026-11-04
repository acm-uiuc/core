import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { createHmac } from "crypto";
import pino from "pino";
import type { Context, SQSEvent } from "aws-lambda";
import { handler } from "../../../../src/api/sqs/index.js";
import { stripeLinkSubscriberCallbackHandler } from "../../../../src/api/sqs/handlers/stripeLinkSubscriberCallbackHandler.js";
import { AvailableSQSFunctions } from "../../../../src/common/types/sqsMessage.js";

const ddbMock = mockClient(DynamoDBClient);
const logger = pino({ level: "silent" });
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
  payerEmail: "payer@example.com",
  occurredAt: "2026-05-13T12:00:00.000Z",
};
const route = {
  primaryKey: "STRIPE_LINK_ROUTE",
  sortKey: payload.linkId,
  linkId: payload.linkId,
  userId: "owner@acm.illinois.edu",
  invoiceId: payload.invoiceId,
  amount: payload.amount,
  url: "https://buy.stripe.com/test_plink",
  createdAt: payload.occurredAt,
  callbackUrl: "https://callbacks.example.com/stripe",
  signingSecret: "secret_123",
  target: {
    namespace: "sandbox",
    businessId: "9edaa632-031d-4f10-bb37-41c44d7d361a",
    fundId: "59a2cc80-38f0-478e-b9cd-59b56a3b9999",
    fundName: "Test Fund",
    rampUserId: "bcb19f24-6264-45ef-bb3f-30c9429b9b4b",
    creatorTenantId: "c8d9148f-9a59-4db3-827d-42ea0c2b6e2e",
    creatorObjectId: "09c1ff32-7be9-40fc-a680-fc942c2883e1",
  },
  stripeAccountId: "acct_123",
  livemode: false,
};
const fetchMock = vi.fn(
  async (_url: RequestInfo | URL, _init?: RequestInit) =>
    new Response(null, { status: 204 }),
);

describe("Stripe subscriber callback routing", () => {
  beforeEach(() => {
    ddbMock.reset();
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  test.each(["immutable", "legacy"])(
    "%s destination receives the signed public payment event",
    async (kind) => {
      if (kind === "immutable") {
        ddbMock.on(GetItemCommand).resolves({ Item: marshall(route) });
        // An expired or conflicting presentation row cannot change this recipient.
        ddbMock.on(QueryCommand).resolves({
          Items: [
            marshall({
              callbackUrl: "https://wrong.example.com",
              signingSecret: "wrong",
            }),
          ],
        });
      } else {
        ddbMock.on(GetItemCommand).resolves({});
        ddbMock.on(QueryCommand).resolves({
          Items: [
            marshall({
              callbackUrl: route.callbackUrl,
              signingSecret: route.signingSecret,
            }),
          ],
        });
      }
      await stripeLinkSubscriberCallbackHandler(payload, metadata, logger);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe(route.callbackUrl);
      if (typeof init?.body !== "string") {
        throw new Error("Callback did not send JSON");
      }
      expect(JSON.parse(init.body)).toEqual({
        type: payload.eventType,
        eventId: payload.eventId,
        linkId: payload.linkId,
        invoiceId: payload.invoiceId,
        amount: payload.amount,
        currency: "usd",
        paidInFull: true,
        paymentMethod: payload.paymentMethod,
        payerName: null,
        payerEmail: payload.payerEmail,
        occurredAt: payload.occurredAt,
      });
      const headers = new Headers(init.headers);
      expect(headers.get("X-ACM-Event-Id")).toBe(payload.eventId);
      const signature = headers.get("X-ACM-Signature")!;
      const timestamp = signature.split(",")[0]!.slice(2);
      const digest = createHmac("sha256", route.signingSecret)
        .update(`${timestamp}.${init.body}`)
        .digest("hex");
      expect(signature).toBe(`t=${timestamp},v1=${digest}`);
    },
  );

  test("missing legacy routing retries instead of acknowledging a lost payment event", async () => {
    ddbMock.on(GetItemCommand).resolves({});
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    await expect(
      stripeLinkSubscriberCallbackHandler(payload, metadata, logger),
    ).rejects.toBeInstanceOf(Error);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("ambiguous legacy routing cannot leak payment details to either subscriber", async () => {
    ddbMock.on(GetItemCommand).resolves({});
    ddbMock.on(QueryCommand).resolves({
      Items: [
        marshall({
          callbackUrl: route.callbackUrl,
          signingSecret: route.signingSecret,
        }),
        marshall({
          callbackUrl: "https://wrong.example.com",
          signingSecret: "wrong",
        }),
      ],
    });
    await expect(
      stripeLinkSubscriberCallbackHandler(payload, metadata, logger),
    ).rejects.toBeInstanceOf(Error);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("the actual queue batch retries missing settlement records without retrying valid siblings", async () => {
    ddbMock.on(GetItemCommand).resolves({});
    const event: SQSEvent = {
      Records: [
        {
          id: "retry-settlement",
          function: AvailableSQSFunctions.ProcessStripeLinkSettlement,
          payload: {
            stripeAccountId: "acct_test",
            livemode: false,
            paymentIntentId: "pi_missing",
          },
        },
        { id: "ack-ping", function: AvailableSQSFunctions.Ping, payload: {} },
      ].map(({ id, function: operation, payload: messagePayload }) => ({
        messageId: id,
        receiptHandle: "fixture-receipt",
        body: JSON.stringify({
          function: operation,
          metadata,
          payload: messagePayload,
        }),
        attributes: {
          ApproximateReceiveCount: "1",
          SentTimestamp: "1778673600000",
          SenderId: "fixture",
          ApproximateFirstReceiveTimestamp: "1778673600000",
        },
        messageAttributes: {},
        md5OfBody: "",
        eventSource: "aws:sqs",
        eventSourceARN: "arn:aws:sqs:us-east-2:427040638965:infra-core-api-sqs",
        awsRegion: "us-east-2",
      })),
    };
    const context: Context = {
      callbackWaitsForEmptyEventLoop: false,
      functionName: "infra-core-api-sqs",
      functionVersion: "$LATEST",
      invokedFunctionArn:
        "arn:aws:lambda:us-east-2:427040638965:function:infra-core-api-sqs",
      memoryLimitInMB: "128",
      awsRequestId: metadata.reqId,
      logGroupName: "/aws/lambda/infra-core-api-sqs",
      logStreamName: "fixture",
      getRemainingTimeInMillis: () => 20_000,
      done: vi.fn(),
      fail: vi.fn(),
      succeed: vi.fn(),
    };
    await expect(handler(event, context)).resolves.toEqual({
      batchItemFailures: [{ itemIdentifier: "retry-settlement" }],
    });
  });
});
