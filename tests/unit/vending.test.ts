import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
import { marshall } from "@aws-sdk/util-dynamodb";
import {
  IoTDataPlaneClient,
  PublishCommand,
} from "@aws-sdk/client-iot-data-plane";
import Stripe from "stripe";
import pino from "pino";
import { AvailableSQSFunctions } from "../../src/common/types/sqsMessage.js";
import {
  capturePaymentIntent,
  getStripePaymentIntentData,
} from "../../src/api/functions/stripe.js";

vi.mock(
  import("../../src/api/functions/stripe.js"),
  async (importOriginal) => ({
    ...(await importOriginal()),
    capturePaymentIntent: vi.fn(),
    getStripePaymentIntentData: vi.fn(),
  }),
);

const dynamo = mockClient(DynamoDBClient);
const sqs = mockClient(SQSClient);
const iot = mockClient(IoTDataPlaneClient);
const sts = mockClient(STSClient);
const dispenseTopic = "vending/vending_machine_qa/commands/vend";
const publishRoleArn =
  "arn:aws:iam::728393074025:role/test-vending-publisher-qa";
const { dispenseVendingItemHandler } = await (async () => {
  vi.stubEnv("VENDING_IOT_ENDPOINT", "https://example.test");
  vi.stubEnv("VENDING_IOT_REGION", "us-east-2");
  vi.stubEnv("VENDING_DISPENSE_TOPIC", dispenseTopic);
  vi.stubEnv("VENDING_IOT_PUBLISH_ROLE_ARN", publishRoleArn);
  try {
    return await import("../../src/api/sqs/handlers/dispenseVendingItem.js");
  } finally {
    vi.unstubAllEnvs();
  }
})();
const { default: init } = await import("../../src/api/server.js");
const app = await init();

const vend = {
  vendId: "31910f4d-26e9-4865-9384-8c2eab6b5687",
  slotId: "A#4",
};
const transaction = {
  ...vend,
  checkoutSessionId: "cs_test",
  paymentIntentId: "pi_test",
  priceCents: 150,
  itemName: "Test item",
  status: "authorized",
  paymentStatus: "authorized",
  createdAt: 123,
};

beforeEach(() => {
  dynamo.reset();
  sqs.reset();
  iot.reset();
  sts.reset();
});

afterAll(() => app.close());

function sendCheckoutCompletedWebhook() {
  const payload = JSON.stringify({
    id: "evt_test",
    type: "checkout.session.completed",
    data: {
      object: {
        id: transaction.checkoutSessionId,
        mode: "payment",
        status: "complete",
        payment_intent: transaction.paymentIntentId,
        amount_total: transaction.priceCents,
        currency: "usd",
        metadata: { ...vend, initiator: "acm-vending" },
      },
    },
  });
  return app.inject({
    method: "POST",
    url: "/api/v1/vending/checkout-completed",
    payload,
    headers: {
      "content-type": "application/json",
      "stripe-signature": Stripe.webhooks.generateTestHeaderString({
        payload,
        secret: app.secretConfig.vending_stripe_endpoint_secret,
      }),
    },
  });
}

test("retries the queue send after the hold was saved and the first send failed", async () => {
  vi.mocked(getStripePaymentIntentData).mockResolvedValue({
    status: "requires_capture",
    amount_capturable: transaction.priceCents,
  } as Stripe.PaymentIntent);
  dynamo
    .on(GetItemCommand)
    .resolvesOnce({
      Item: marshall({
        ...transaction,
        paymentIntentId: null,
        status: "pending_payment",
        paymentStatus: "pending",
      }),
    })
    .resolvesOnce({ Item: marshall(transaction) })
    .resolves({ Item: marshall({ ...transaction, dispenseQueuedAt: 456 }) });
  dynamo.on(UpdateItemCommand).resolves({});
  sqs.on(SendMessageCommand).rejectsOnce("Queue unavailable").resolves({});

  expect((await sendCheckoutCompletedWebhook()).statusCode).toBe(500);
  expect(dynamo.commandCalls(UpdateItemCommand)).toHaveLength(1);

  expect((await sendCheckoutCompletedWebhook()).statusCode).toBe(200);
  expect((await sendCheckoutCompletedWebhook()).statusCode).toBe(200);
  const sends = sqs.commandCalls(SendMessageCommand);
  expect(sends).toHaveLength(2);
  expect(JSON.parse(sends[1].args[0].input.MessageBody!)).toMatchObject({
    function: AvailableSQSFunctions.DispenseVendingItem,
    payload: vend,
  });
  expect(
    dynamo.commandCalls(UpdateItemCommand)[2].args[0].input.UpdateExpression,
  ).toContain("dispenseQueuedAt");
});

test("acknowledges a capture retry without calling Stripe again", async () => {
  const { createJwt } = await import("./utils.js");
  vi.mocked(getStripePaymentIntentData)
    .mockClear()
    .mockResolvedValue({
      id: transaction.paymentIntentId,
      status: "requires_capture",
    } as Stripe.PaymentIntent);
  vi.mocked(capturePaymentIntent).mockResolvedValue({
    id: transaction.paymentIntentId,
    status: "succeeded",
  } as Stripe.PaymentIntent);
  dynamo
    .on(GetItemCommand)
    .resolvesOnce({ Item: marshall(transaction) })
    .resolves({
      Item: marshall({ ...transaction, paymentStatus: "captured" }),
    });
  dynamo.on(UpdateItemCommand).resolves({});

  const request = {
    method: "POST" as const,
    url: "/api/v1/vending/capture",
    headers: { authorization: `Bearer ${createJwt()}` },
    payload: { vendId: vend.vendId, idempotencyKey: "capture-vend-test" },
  };
  expect((await app.inject(request)).statusCode).toBe(200);
  expect((await app.inject(request)).statusCode).toBe(200);
  expect(getStripePaymentIntentData).toHaveBeenCalledTimes(1);
  expect(capturePaymentIntent).toHaveBeenCalledTimes(1);
  expect(dynamo.commandCalls(UpdateItemCommand)).toHaveLength(1);
});

const runDispenseJob = () =>
  dispenseVendingItemHandler(
    vend,
    { initiator: "evt_test", reqId: "req-test" },
    pino({ enabled: false }),
  );

test("publishes the authorized vend and propagates a broker failure for SQS to retry", async () => {
  iot.on(PublishCommand).rejectsOnce("Broker unavailable").resolves({});

  await expect(runDispenseJob()).rejects.toThrow("Broker unavailable");
  await runDispenseJob();
  const publishes = iot.commandCalls(PublishCommand);
  expect(publishes).toHaveLength(2);
  const command = publishes[1].args[0].input;
  expect(command).toMatchObject({
    topic: dispenseTopic,
    qos: 1,
    retain: false,
    payload: Buffer.from(JSON.stringify(vend)),
  });
  const firstPayload = JSON.parse(
    Buffer.from(publishes[0].args[0].input.payload!).toString(),
  );
  expect(firstPayload).toEqual(vend);
});

test("uses a role in the vending account to authenticate the publish", async () => {
  sts.on(AssumeRoleCommand).resolves({
    Credentials: {
      AccessKeyId: "test-access-key",
      SecretAccessKey: "test-secret-key",
      SessionToken: "test-session-token",
      Expiration: new Date(Date.now() + 900_000),
    },
  });
  iot.on(PublishCommand).callsFake(async (_input, getClient) => {
    const credentials = await getClient().config.credentials();
    expect(credentials.accessKeyId).toBe("test-access-key");
    return {};
  });
  await runDispenseJob();
  expect(sts.commandCalls(AssumeRoleCommand)).toHaveLength(1);
  expect(sts.commandCalls(AssumeRoleCommand)[0].args[0].input.RoleArn).toBe(
    publishRoleArn,
  );
});
