import { afterAll, expect, test, beforeEach, vi, describe } from "vitest";
import init from "../../src/api/index.js";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { mockClient } from "aws-sdk-client-mock";
import { secretJson } from "./secret.testdata.js";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import supertest from "supertest";
import { createJwt } from "./auth.test.js";

const smMock = mockClient(SecretsManagerClient);
const ddbMock = mockClient(DynamoDBClient);

vi.mock("stripe", () => {
  const productMock = { id: "prod_123" };
  const priceMock = { id: "price_123" };
  const paymentLinkMock = {
    id: "plink_123",
    url: "https://stripe.com/payment-link",
  };

  return {
    default: vi.fn(() => ({
      products: {
        create: vi.fn().mockResolvedValue(productMock),
      },
      prices: {
        create: vi.fn().mockResolvedValue(priceMock),
      },
      paymentLinks: {
        create: vi.fn().mockResolvedValue(paymentLinkMock),
      },
    })),
  };
});

const app = await init();
describe("Test Stripe link creation", async () => {
  test("Test body validation 1", async () => {
    smMock.on(GetSecretValueCommand).resolves({
      SecretString: secretJson,
    });
    ddbMock.on(PutItemCommand).rejects();
    const testJwt = createJwt();
    await app.ready();

    const response = await supertest(app.server)
      .post("/api/v1/stripe/paymentLinks")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        invoiceId: "",
        invoiceAmountUsd: 49,
        contactName: "",
      });
    expect(response.statusCode).toBe(400);
    expect(response.body).toStrictEqual({
      error: true,
      name: "ValidationError",
      id: 104,
      message:
        'String must contain at least 1 character(s) at "invoiceId"; Number must be greater than or equal to 50 at "invoiceAmountUsd"; String must contain at least 1 character(s) at "contactName"; Required at "contactEmail"',
    });
  });
  test("Test body validation 2", async () => {
    smMock.on(GetSecretValueCommand).resolves({
      SecretString: secretJson,
    });
    ddbMock.on(PutItemCommand).rejects();
    const testJwt = createJwt();
    await app.ready();

    const response = await supertest(app.server)
      .post("/api/v1/stripe/paymentLinks")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        invoiceId: "ACM102",
        invoiceAmountUsd: 51,
        contactName: "Dev",
        contactEmail: "invalidEmail",
      });
    expect(response.statusCode).toBe(400);
    expect(response.body).toStrictEqual({
      error: true,
      name: "ValidationError",
      id: 104,
      message: 'Invalid email at "contactEmail"',
    });
  });
  test("Happy Path", async () => {
    ddbMock.on(PutItemCommand).resolves({});
    const testJwt = createJwt();
    await app.ready();

    const response = await supertest(app.server)
      .post("/api/v1/stripe/paymentLinks")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        invoiceId: "ACM102",
        invoiceAmountUsd: 51,
        contactName: "Infra User",
        contactEmail: "testing@acm.illinois.edu",
      });
    expect(response.statusCode).toBe(201);
    console.log(response.body);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    (app as any).nodeCache.flushAll();
    vi.clearAllMocks();
    smMock.on(GetSecretValueCommand).resolves({
      SecretString: secretJson,
    });
  });
});
