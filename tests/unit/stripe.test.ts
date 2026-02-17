import {
  afterAll,
  expect,
  test,
  beforeEach,
  vi,
  describe,
  afterEach,
} from "vitest";
import init from "../../src/api/server.js";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import supertest from "supertest";
import { createJwt } from "./utils.js";
import { marshall } from "@aws-sdk/util-dynamodb";
import { randomUUID } from "crypto";
import { encodeInvoiceToken } from "../../src/common/utils.js";

const ddbMock = mockClient(DynamoDBClient);
const linkId = randomUUID();
const productId = randomUUID();
const priceId = randomUUID();
const productMock = { id: productId };
const priceMock = { id: priceId };
const paymentLinkMock = {
  id: linkId,
  url: `https://buy.stripe.com/${linkId}`,
};
const customerId = randomUUID();
const customerMock = { id: `cus_${customerId}` };

vi.mock("stripe", () => {
  const StripeCtor = vi.fn(function () {
    return {
      customers: {
        create: vi.fn(() => Promise.resolve(customerMock)),
        retrieve: vi.fn(() =>
          Promise.resolve({ name: "Old Name", email: "old@example.com" }),
        ),
      },
      products: {
        create: vi.fn(() => Promise.resolve(productMock)),
        update: vi.fn(() => Promise.resolve({})),
      },
      prices: {
        create: vi.fn(() => Promise.resolve(priceMock)),
      },
      paymentLinks: {
        create: vi.fn(() => Promise.resolve(paymentLinkMock)),
        update: vi.fn(() => Promise.resolve({})),
      },
      checkout: {
        sessions: {
          create: vi.fn(() =>
            Promise.resolve({ url: "https://checkout.stripe.com/test" }),
          ),
        },
      },
      webhooks: { constructEvent: vi.fn() },
      paymentIntents: { retrieve: vi.fn(), capture: vi.fn(), cancel: vi.fn() },
      paymentMethods: { retrieve: vi.fn() },
      refunds: { create: vi.fn() },
    };
  });

  return {
    default: StripeCtor,
    Stripe: StripeCtor, // <-- THIS is what you're missing
  };
});

const app = await init();
describe("Test Stripe link creation", async () => {
  test("Unauthenticated access (missing token)", async () => {
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/stripe/paymentLinks")
      .send({
        acmOrg: "C01",
        invoiceId: "ACM102",
        invoiceAmountUsd: 100,
        contactName: "John Doe",
        contactEmail: "john@example.com",
      });
    expect(response.statusCode).toBe(401);
  });
  test("Validation failure: Missing required fields", async () => {
    await app.ready();
    const testJwt = createJwt();
    const response = await supertest(app.server)
      .post("/api/v1/stripe/paymentLinks")
      .set("authorization", `Bearer ${testJwt}`)
      .send({});
    expect(response.statusCode).toBe(400);
  });
  test("Validation failure: Invalid amount", async () => {
    const testJwt = createJwt();
    const response = await supertest(app.server)
      .post("/api/v1/stripe/paymentLinks")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        acmOrg: "C01",
        invoiceId: "ACM102",
        invoiceAmountUsd: 10,
        contactName: "John Doe",
        contactEmail: "john@example.com",
      });
    expect(response.statusCode).toBe(400);
  });
  test("Test body validation 1", async () => {
    ddbMock.on(PutItemCommand).rejects();
    const testJwt = createJwt();
    await app.ready();

    const response = await supertest(app.server)
      .post("/api/v1/stripe/paymentLinks")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        acmOrg: "C01",
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
        "body/invoiceId Too small: expected string to have >=1 characters, body/invoiceAmountUsd Too small: expected number to be >=50, body/contactName Too small: expected string to have >=1 characters, body/contactEmail Invalid input: expected string, received undefined",
    });
    expect(ddbMock.calls().length).toEqual(0);
  });
  test("Test body validation 2", async () => {
    ddbMock.on(PutItemCommand).rejects();
    const testJwt = createJwt();
    await app.ready();

    const response = await supertest(app.server)
      .post("/api/v1/stripe/paymentLinks")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        acmOrg: "C01",
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
      message: "body/contactEmail Invalid email address",
    });
    expect(ddbMock.calls().length).toEqual(0);
  });
  test("POST happy path", async () => {
    const invoicePayload = {
      acmOrg: "C01",
      invoiceId: "ACM102",
      invoiceAmountUsd: 51,
      contactName: "Infra User",
      contactEmail: "testing@acm.illinois.edu",
    };
    // customer lookup (no existing customer)
    ddbMock.on(QueryCommand).resolvesOnce({ Count: 0, Items: [] });

    // addInvoice does 1+ transactions; easiest is “always succeed”
    ddbMock.on(TransactWriteItemsCommand).resolves({});
    const testJwt = createJwt();
    await app.ready();

    const response = await supertest(app.server)
      .post("/api/v1/stripe/paymentLinks")
      .set("authorization", `Bearer ${testJwt}`)
      .send(invoicePayload);
    expect(response.statusCode).toBe(201);
    expect(response.body.id).toBe(invoicePayload.invoiceId);
    expect(response.body.link).toContain("/");
    expect(ddbMock.calls().length).toBeGreaterThan(0);
  });
  test("Unauthenticated GET access (missing token)", async () => {
    await app.ready();
    const response = await supertest(app.server).get(
      "/api/v1/stripe/paymentLinks",
    );
    expect(response.statusCode).toBe(401);
  });
  test("GET database errors are handled correctly", async () => {
    ddbMock.on(ScanCommand).rejects({});
    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .get("/api/v1/stripe/paymentLinks")
      .set("authorization", `Bearer ${testJwt}`);
    expect(response.statusCode).toBe(500);
  });
  test("GET happy path: Fetching all payment links when none exist", async () => {
    ddbMock.on(ScanCommand).resolves({});
    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .get("/api/v1/stripe/paymentLinks")
      .set("authorization", `Bearer ${testJwt}`);
    expect(response.statusCode).toBe(200);
  });
  test("Fetching all payment links successfully", async () => {
    ddbMock.on(ScanCommand).resolves({
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
    const testJwt = createJwt();
    const response = await supertest(app.server)
      .get("/api/v1/stripe/paymentLinks")
      .set("authorization", `Bearer ${testJwt}`);
    expect(response.statusCode).toBe(200);
    expect(response.body).toStrictEqual([
      {
        id: linkId,
        userId: "testUser@illinois.edu",
        link: paymentLinkMock.url,
        active: true,
        invoiceId: "ACM102",
        invoiceAmountUsd: 100,
        createdAt: "2025-02-09T17:11:30.762Z",
      },
    ]);
  });
  test("Fetching user-owned payment links successfully (enforce OLA)", async () => {
    ddbMock
      .on(ScanCommand)
      .rejects(new Error("Should not be called when OLA is enforced!"));
    ddbMock.on(QueryCommand).resolvesOnce({
      Count: 1,
      Items: [
        marshall({
          linkId,
          userId: "infra-unit-test-stripeonly@acm.illinois.edu",
          url: paymentLinkMock.url,
          active: true,
          invoiceId: "ACM103",
          amount: 999,
          createdAt: "2025-02-09T17:11:30.762Z",
        }),
      ],
    });
    const testJwt = createJwt(
      undefined,
      ["1"],
      "infra-unit-test-stripeonly@acm.illinois.edu",
    );
    const response = await supertest(app.server)
      .get("/api/v1/stripe/paymentLinks")
      .set("authorization", `Bearer ${testJwt}`);
    expect(response.statusCode).toBe(200);
    expect(response.body).toStrictEqual([
      {
        id: linkId,
        userId: "infra-unit-test-stripeonly@acm.illinois.edu",
        link: paymentLinkMock.url,
        active: true,
        invoiceId: "ACM103",
        invoiceAmountUsd: 999,
        createdAt: "2025-02-09T17:11:30.762Z",
      },
    ]);
  });
  test("DELETE happy path", async () => {
    ddbMock.on(QueryCommand).resolvesOnce({
      Items: [
        marshall({
          userId: "infra@acm.illinois.edu",
          invoiceId: "UNITTEST1",
          amount: 10000,
          priceId: "price_abc123",
          productId: "prod_abc123",
        }),
      ],
    });
    ddbMock.on(TransactWriteItemsCommand).resolvesOnce({});
    const testJwt = createJwt();
    await app.ready();

    const response = await supertest(app.server)
      .delete("/api/v1/stripe/paymentLinks/plink_abc123")
      .set("authorization", `Bearer ${testJwt}`)
      .send();
    expect(response.statusCode).toBe(204);
    expect(ddbMock.calls().length).toEqual(2);
  });
  test("DELETE fails on not user-owned links", async () => {
    await app.ready();
    ddbMock.on(QueryCommand).resolvesOnce({
      Items: [
        marshall({
          userId: "defsuperdupernotme@acm.illinois.edu",
          invoiceId: "UNITTEST1",
          amount: 10000,
          priceId: "price_abc123",
          productId: "prod_abc123",
        }),
      ],
    });
    ddbMock.on(TransactWriteItemsCommand).rejects();
    const testJwt = createJwt(
      undefined,
      ["999"],
      "infra-unit-test-stripeonly@acm.illinois.edu",
    );

    const response = await supertest(app.server)
      .delete("/api/v1/stripe/paymentLinks/plink_abc123")
      .set("authorization", `Bearer ${testJwt}`)
      .send();
    expect(response.statusCode).toBe(403);
    expect(ddbMock.calls().length).toEqual(1);
  });
  test("POST returns 409 when existing Stripe customer info differs (needsConfirmation)", async () => {
    const invoicePayload = {
      acmOrg: "C01",
      invoiceId: "ACM409",
      invoiceAmountUsd: 51,
      contactName: "New Name",
      contactEmail: "new@example.com",
    };

    // checkOrCreateCustomer: CUSTOMER lookup returns existing customer
    ddbMock.on(QueryCommand).resolvesOnce({
      Count: 1,
      Items: [marshall({ stripeCustomerId: "cus_existing" })],
    });

    // ensureEmailMap transact inside checkOrCreateCustomer
    ddbMock.on(TransactWriteItemsCommand).resolves({});

    const testJwt = createJwt();
    await app.ready();

    const response = await supertest(app.server)
      .post("/api/v1/stripe/paymentLinks")
      .set("authorization", `Bearer ${testJwt}`)
      .send(invoicePayload);

    expect(response.statusCode).toBe(409);
    expect(response.body.needsConfirmation).toBe(true);
    expect(response.body.customerId).toBe("cus_existing");
    expect(response.body.current).toBeTruthy();
    expect(response.body.incoming).toBeTruthy();
  });
  test("GET /pay/:token redirects to Stripe checkout session url (302)", async () => {
    await app.ready();

    const token = encodeInvoiceToken({
      orgId: "C01",
      emailDomain: "acm.illinois.edu",
      invoiceId: "INV_PAY_1",
    });

    // 1) invoice query
    ddbMock.on(QueryCommand).resolvesOnce({
      Items: [
        marshall({
          invoiceAmtUsd: 5100, //
        }),
      ],
    });

    // 2) customer query
    ddbMock.on(QueryCommand).resolvesOnce({
      Items: [
        marshall({
          stripeCustomerId: "cus_pay_1",
        }),
      ],
    });

    const response = await supertest(app.server).get(
      `/api/v1/stripe/pay/${token}`,
    );

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain("https://checkout.stripe.com/");
  });

  afterAll(async () => {
    await app.close();
  });
  afterEach(() => {
    ddbMock.reset();
  });
  beforeEach(() => {
    (app as any).redisClient.flushall();
    vi.clearAllMocks();
  });
});
