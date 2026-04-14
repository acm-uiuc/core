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
import { encodeInvoiceToken } from "src/common/utils.ts";

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
  const StripeCtor: any = vi.fn(function () {
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
      paymentIntents: {
        retrieve: vi.fn(() =>
          Promise.resolve({
            next_action: {
              display_bank_transfer_instructions: {
                amount_remaining: 200,
              },
            },
          }),
        ),
        capture: vi.fn(),
        cancel: vi.fn(),
      },
      paymentMethods: { retrieve: vi.fn() },
      refunds: { create: vi.fn() },
    };
  });

  StripeCtor.webhooks = { constructEvent: vi.fn() };

  return {
    default: StripeCtor,
    Stripe: StripeCtor,
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
    expect(response.body.id).toBeDefined();
    expect(response.body.invoiceId).toBe(invoicePayload.invoiceId);
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
          achPaymentsEnabled: false,
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
        achPaymentsEnabled: false,
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
          achPaymentsEnabled: false,
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
        achPaymentsEnabled: false,
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
  test("POST /webhook: Handles checkout.session.completed successfully", async () => {
    const mockInvoiceId = "ACM-999";
    const mockOrg = "C01";
    const mockEmail = "payer@illinois.edu";
    const mockDomain = "illinois.edu";
    const mockEventId = "evt_test_123";

    const StripeMock = await import("stripe");
    (StripeMock.default.webhooks.constructEvent as any).mockReturnValue({
      id: mockEventId,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_abc",
          payment_status: "paid",
          amount_total: 5000,
          currency: "usd",
          customer_details: { email: mockEmail },
          metadata: {
            invoice_id: mockInvoiceId,
            acm_org: mockOrg,
          },
          payment_intent: "pi_test_abc",
        },
      },
    });

    ddbMock.on(QueryCommand).resolves({
      Count: 1,
      Items: [
        marshall({
          primaryKey: `${mockOrg}#${mockDomain}`,
          sortKey: `CHARGE#${mockInvoiceId}`,
          createdBy: "not-an-email",
        }),
      ],
    });

    ddbMock.on(TransactWriteItemsCommand).resolves({});

    await app.ready();

    const response = await supertest(app.server)
      .post("/api/v1/stripe/webhook")
      .set("stripe-signature", "t=123,v1=abc")
      .send({ id: "dummy_event" });

    expect(response.statusCode).toBe(200);
    expect(response.body.handled).toBe(true);

    const ddbCalls = ddbMock.commandCalls(TransactWriteItemsCommand);
    expect(ddbCalls.length).toBe(0);
  });
  test("POST /webhook: Handles payment_intent.partially_funded successfully", async () => {
    const mockInvoiceId = "ACM-555";
    const mockOrg = "C01";
    const mockEmail = "payer@illinois.edu";
    const mockDomain = "illinois.edu";
    const mockEventId = "evt_partial_123";

    const StripeMock = await import("stripe");
    (StripeMock.default.webhooks.constructEvent as any).mockReturnValue({
      id: mockEventId,
      type: "payment_intent.partially_funded",
      data: {
        object: {
          id: "pi_partial_test",
          amount_received: 300,
          currency: "usd",
          receipt_email: mockEmail,
          metadata: {
            invoice_id: mockInvoiceId,
            acm_org: mockOrg,
          },
        },
      },
    });

    ddbMock.on(QueryCommand).resolves({
      Count: 1,
      Items: [
        marshall({
          primaryKey: `${mockOrg}#${mockDomain}`,
          sortKey: `CHARGE#${mockInvoiceId}`,
          createdBy: "not-an-email",
          invoiceAmtUsd: 6,
          paidAmount: 0,
        }),
      ],
    });

    await app.ready();

    const response = await supertest(app.server)
      .post("/api/v1/stripe/webhook")
      .set("stripe-signature", "t=123,v1=abc")
      .send({ id: "dummy_event" });

    expect(response.statusCode).toBe(200);
    expect(response.body.handled).toBe(true);
  });
  test("GET /api/v1/stripe/pay/status returns invoice status from query token", async () => {
    const realToken = encodeInvoiceToken({
      orgId: "S02",
      emailDomain: "illinois.edu",
      invoiceId: "11",
    });

    ddbMock.on(QueryCommand).resolvesOnce({
      Items: [
        marshall({
          primaryKey: "S02#illinois.edu",
          sortKey: "CHARGE#11",
          invoiceAmtUsd: 1,
          paidAmount: 1,
          lastPaidAt: "2026-04-07T20:43:48.098Z",
        }),
      ],
    });

    await app.ready();

    const response = await supertest(app.server).get(
      `/api/v1/stripe/pay/status?token=${encodeURIComponent(realToken)}`,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toStrictEqual({
      invoiceId: "11",
      acmOrg: "S02",
      status: "paid",
      invoiceAmountUsd: 1,
      paidAmountUsd: 1,
      remainingAmountUsd: 0,
      lastPaidAt: "2026-04-07T20:43:48.098Z",
    });
  });

  test("GET /api/v1/stripe/pay/status without query token returns 400", async () => {
    await app.ready();

    const response = await supertest(app.server).get(
      "/api/v1/stripe/pay/status",
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      error: true,
      name: "ValidationError",
      id: 104,
    });
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
