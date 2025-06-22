import { afterAll, expect, test, beforeEach, vi, describe } from "vitest";
import init from "../../src/api/index.js";
import { mockClient } from "aws-sdk-client-mock";
import { secretObject } from "./secret.testdata.js";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import supertest from "supertest";
import { v4 as uuidv4 } from "uuid";
import { marshall } from "@aws-sdk/util-dynamodb";
import stripe from "stripe";
import { genericConfig } from "../../src/common/config.js";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

const ddbMock = mockClient(DynamoDBClient);
const sqsMock = mockClient(SQSClient);

const linkId = uuidv4();
const paymentLinkMock = {
  id: linkId,
  url: `https://buy.stripe.com/${linkId}`,
};

const app = await init();
describe("Test Stripe webhooks", async () => {
  test("Stripe Payment Link skips non-existing links", async () => {
    const queueId = uuidv4();
    sqsMock.on(SendMessageCommand).rejects();
    ddbMock
      .on(QueryCommand, {
        TableName: genericConfig.StripeLinksDynamoTableName,
        IndexName: "LinkIdIndex",
      })
      .resolvesOnce({
        Items: [],
      });
    const payload = JSON.stringify({
      type: "checkout.session.completed",
      id: "evt_abc123",
      data: {
        object: {
          payment_link: linkId,
          amount_total: 10000,
          currency: "usd",
          customer_details: {
            name: "Test User",
            email: "testuser@example.com",
          },
        },
      },
    });
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/stripe/webhook")
      .set("content-type", "application/json")
      .set(
        "stripe-signature",
        stripe.webhooks.generateTestHeaderString({
          payload,
          secret: secretObject.stripe_links_endpoint_secret,
        }),
      )
      .send(payload);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        handled: false,
      }),
    );
  });
  test("Stripe Payment Link validates webhook signature", async () => {
    const queueId = uuidv4();
    sqsMock.on(SendMessageCommand).rejects();
    ddbMock
      .on(QueryCommand, {
        TableName: genericConfig.StripeLinksDynamoTableName,
        IndexName: "LinkIdIndex",
      })
      .rejects();
    const payload = JSON.stringify({
      type: "checkout.session.completed",
      id: "evt_abc123",
      data: {
        object: {
          payment_link: linkId,
          amount_total: 10000,
          currency: "usd",
          customer_details: {
            name: "Test User",
            email: "testuser@example.com",
          },
        },
      },
    });
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/stripe/webhook")
      .set("content-type", "application/json")
      .set(
        "stripe-signature",
        stripe.webhooks.generateTestHeaderString({ payload, secret: "nah" }),
      )
      .send(payload);
    expect(response.statusCode).toBe(400);
    expect(response.body).toStrictEqual({
      error: true,
      id: 104,
      message: "Stripe webhook could not be validated.",
      name: "ValidationError",
    });
  });
  test("Stripe Payment Link emails successfully", async () => {
    const queueId = uuidv4();
    sqsMock.on(SendMessageCommand).resolves({ MessageId: queueId });
    ddbMock
      .on(QueryCommand, {
        TableName: genericConfig.StripeLinksDynamoTableName,
        IndexName: "LinkIdIndex",
      })
      .resolves({
        Count: 1,
        Items: [
          marshall({
            linkId,
            userId: "testUser@illinois.edu",
            url: paymentLinkMock.url,
            active: true,
            invoiceId: "ACM102",
            amount: 100,
            createdAt: "2025-02-09T17:11:30.762Z",
          }),
        ],
      });
    const payload = JSON.stringify({
      type: "checkout.session.completed",
      id: "evt_abc123",
      data: {
        object: {
          payment_link: linkId,
          amount_total: 10000,
          currency: "usd",
          customer_details: {
            name: "Test User",
            email: "testuser@example.com",
          },
        },
      },
    });
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/stripe/webhook")
      .set("content-type", "application/json")
      .set(
        "stripe-signature",
        stripe.webhooks.generateTestHeaderString({
          payload,
          secret: secretObject.stripe_links_endpoint_secret,
        }),
      )
      .send(payload);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        handled: true,
        queueId,
      }),
    );
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    (app as any).nodeCache.flushAll();
    ddbMock.reset();
    sqsMock.reset();
  });
});
