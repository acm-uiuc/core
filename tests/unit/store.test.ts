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
  GetItemCommand,
  ScanCommand,
  QueryCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import supertest from "supertest";
import { createJwt } from "./auth.test.js";
import { marshall } from "@aws-sdk/util-dynamodb";
import { AppRoles } from "../../src/common/roles.js";

// Mock DynamoDB
const ddbMock = mockClient(DynamoDBClient);

// Mock Stripe
const mockStripeSession = {
  id: "sess_123",
  url: "https://checkout.stripe.com/test",
  metadata: {
    initiator: "acm-store",
    orderId: "order_123",
    userId: "test@illinois.edu",
  },
  payment_intent: "pi_123",
};

const mockStripeConstructEvent = vi.fn();

vi.mock("stripe", () => {
  return {
    default: vi.fn(function () {
      return {
        checkout: {
          sessions: {
            create: vi.fn(() => Promise.resolve(mockStripeSession)),
          },
        },
        products: {
          create: vi.fn(() => Promise.resolve({ id: "prod_123" })),
        },
        prices: {
          create: vi.fn(() => Promise.resolve({ id: "price_123" })),
        },
        webhooks: {
          constructEvent: mockStripeConstructEvent,
        },
      };
    }),
  };
});

// Mock UIUC Token Verification
vi.mock("../../src/api/functions/uin.js", async () => {
  return {
    verifyUiucAccessToken: vi.fn().mockResolvedValue({
      userPrincipalName: "test@illinois.edu",
      uin: "123456789",
    }),
  };
});

// Mock Redis/Rate Limiter setup if needed implicitly by server init,
// but we handle flushall in beforeEach.

const app = await init();

describe("Store Routes API", () => {
  beforeEach(() => {
    (app as any).redisClient.flushall();
    ddbMock.reset();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  // ============ Public Routes ============

  describe("Public Routes", () => {
    test("GET /products should list available products", async () => {
      ddbMock.on(ScanCommand).resolves({
        Items: [
          marshall({
            productId: "prod_1",
            name: "Test T-Shirt",
            price: 2000,
            active: true,
          }),
        ],
      });

      const response = await supertest(app.server).get(
        "/api/v1/store/products",
      );

      expect(response.statusCode).toBe(200);
      expect(response.body.products).toHaveLength(1);
      expect(response.body.products[0].productId).toBe("prod_1");
    });

    test("GET /products/:productId should return product details", async () => {
      ddbMock.on(GetItemCommand).resolves({
        Item: marshall({
          productId: "prod_1",
          name: "Test T-Shirt",
          price: 2000,
          description: "A cool shirt",
        }),
      });

      const response = await supertest(app.server).get(
        "/api/v1/store/products/prod_1",
      );

      expect(response.statusCode).toBe(200);
      expect(response.body.name).toBe("Test T-Shirt");
    });
  });

  // ============ Authenticated User Routes ============

  describe("Checkout Routes", () => {
    test("POST /checkout should create a session", async () => {
      // Mock the order creation in DynamoDB
      ddbMock.on(PutItemCommand).resolves({});

      const validBody = {
        items: [{ productId: "prod_1", variantId: "var_1", quantity: 1 }],
        successRedirPath: "/success",
        cancelRedirPath: "/cancel",
      };

      const response = await supertest(app.server)
        .post("/api/v1/store/checkout")
        .set("x-uiuc-token", "valid-mock-token") // Mocked by verifyUiucAccessToken
        .send(validBody);

      expect(response.statusCode).toBe(201);
      expect(response.body.sessionId).toBe("sess_123");
      expect(response.body.checkoutUrl).toBe(
        "https://checkout.stripe.com/test",
      );
    });

    test("POST /checkout fail validation on invalid body", async () => {
      const invalidBody = {
        items: [], // Empty items
      };

      const response = await supertest(app.server)
        .post("/api/v1/store/checkout")
        .set("x-uiuc-token", "valid-mock-token")
        .send(invalidBody);

      expect(response.statusCode).toBe(400);
    });
  });

  // ============ Admin Routes ============

  describe("Admin Routes", () => {
    // Helper to create admin JWT
    const adminJwt = createJwt(undefined, [AppRoles.STORE_MANAGER]);
    const userJwt = createJwt(undefined, ["Student"]);

    test("GET /admin/products should be forbidden for non-admins", async () => {
      const response = await supertest(app.server)
        .get("/api/v1/store/admin/products")
        .set("Authorization", `Bearer ${userJwt}`);

      expect(response.statusCode).toBe(403);
    });

    test("GET /admin/products should list all products for admin", async () => {
      ddbMock.on(ScanCommand).resolves({
        Items: [
          marshall({ productId: "prod_1", name: "Active", active: true }),
          marshall({ productId: "prod_2", name: "Inactive", active: false }),
        ],
      });

      const response = await supertest(app.server)
        .get("/api/v1/store/admin/products")
        .set("Authorization", `Bearer ${adminJwt}`);

      expect(response.statusCode).toBe(200);
      expect(response.body.products).toHaveLength(2);
    });

    test("POST /admin/products should create a new product", async () => {
      ddbMock.on(PutItemCommand).resolves({}); // Product creation

      const newProduct = {
        name: "New Hoodie",
        description: "Comfy",
        price: 4500,
        category: "Apparel",
        variants: [{ name: "Size", options: ["S", "M", "L"] }],
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 100000).toISOString(),
      };

      const response = await supertest(app.server)
        .post("/api/v1/store/admin/products")
        .set("Authorization", `Bearer ${adminJwt}`)
        .send(newProduct);

      expect(response.statusCode).toBe(201);
      expect(response.body.success).toBe(true);
      // expect(ddbMock).toHaveReceivedCommand(PutItemCommand); // If using aws-sdk-mock extensions
    });

    test("GET /admin/orders/:productId should fetch orders", async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [marshall({ orderId: "ord_1", status: "paid", userId: "bob" })],
      });

      const response = await supertest(app.server)
        .get("/api/v1/store/admin/orders/prod_1")
        .set("Authorization", `Bearer ${adminJwt}`);

      expect(response.statusCode).toBe(200);
      expect(response.body.orders).toHaveLength(1);
    });
  });

  // ============ Webhook Routes ============

  describe("Webhook Routes", () => {
    test("POST /webhook should process checkout.session.completed", async () => {
      // Mock Stripe signature verification success
      mockStripeConstructEvent.mockReturnValue({
        type: "checkout.session.completed",
        data: {
          object: mockStripeSession,
        },
      });

      // Mock DynamoDB update for order status
      ddbMock.on(UpdateItemCommand).resolves({});

      const response = await supertest(app.server)
        .post("/api/v1/store/webhook")
        .set("stripe-signature", "valid_signature")
        .send({ some: "raw body" }); // Content doesn't matter as we mocked constructEvent

      expect(response.statusCode).toBe(200);
      expect(response.body.handled).toBe(true);
      expect(mockStripeConstructEvent).toHaveBeenCalled();
    });

    test("POST /webhook should ignore non-store events", async () => {
      mockStripeConstructEvent.mockReturnValue({
        type: "checkout.session.completed",
        data: {
          object: {
            ...mockStripeSession,
            metadata: { initiator: "other-service" },
          },
        },
      });

      const response = await supertest(app.server)
        .post("/api/v1/store/webhook")
        .set("stripe-signature", "valid_signature")
        .send({});

      expect(response.statusCode).toBe(200);
      expect(response.body.handled).toBe(false);
    });

    test("POST /webhook should fail with invalid signature", async () => {
      mockStripeConstructEvent.mockImplementation(() => {
        throw new Error("Invalid Signature");
      });

      const response = await supertest(app.server)
        .post("/api/v1/store/webhook")
        .set("stripe-signature", "invalid")
        .send({});

      // The route handler catches the error and throws a ValidationError
      // Fastify standard error response is usually 400 for ValidationError
      expect(response.statusCode).toBe(400);
    });
  });
});
