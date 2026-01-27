import { expect, test, beforeEach, vi, describe } from "vitest";
import init from "../../src/api/server.js";
import { mockClient } from "aws-sdk-client-mock";
import {
  BatchGetItemCommand,
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { SQSClient } from "@aws-sdk/client-sqs";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { createJwt } from "./auth.test.js";
import { genericConfig } from "../../src/common/config.js";
import {
  closedProductDefinition,
  closedProductOnlyVariant,
  inventoryTableEntries,
  paidJwt,
  testingProductDefinition,
  testingProductLargeVariant,
  testingProductSmallVariant,
} from "./store.testdata.js";
import { FastifyBaseLogger } from "fastify";
import { marshall } from "@aws-sdk/util-dynamodb";
import { DEFAULT_VARIANT_ID } from "../../src/common/types/store.js";

const app = await init();
const ddbMock = mockClient(DynamoDBClient);
const sqsMock = mockClient(SQSClient);
const smMock = mockClient(SecretsManagerClient);
const testJwt = createJwt();

// Use vi.hoisted() so this is available when vi.mock is hoisted
const {
  mockCreateCheckoutSessionWithCustomer,
  mockCreateCheckoutSession,
  mockVerifyUiucAccessToken,
} = vi.hoisted(() => ({
  mockCreateCheckoutSessionWithCustomer: vi.fn(),
  mockCreateCheckoutSession: vi.fn(),
  mockVerifyUiucAccessToken: vi.fn(),
}));

vi.mock("../../src/api/functions/stripe.js", async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    createCheckoutSessionWithCustomer: mockCreateCheckoutSessionWithCustomer,
    createCheckoutSession: mockCreateCheckoutSession,
  };
});

vi.mock("../../src/api/functions/uin.js", async () => {
  const actual = await vi.importActual("../../src/api/functions/uin.js");
  return {
    ...actual,
    verifyUiucAccessToken: mockVerifyUiucAccessToken,
  };
});

describe("Staleness bound authentication requirement", () => {
  beforeEach(() => {
    (app as any).redisClient.flushall();
    ddbMock.reset();
    sqsMock.reset();
    smMock.reset();
    vi.clearAllMocks();
  });

  test("GET /products", async () => {
    ddbMock
      .on(ScanCommand, {
        TableName: genericConfig.StoreInventoryTableName,
      })
      .resolvesOnce({
        Items: inventoryTableEntries,
      })
      .rejects();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/store/products?ts=1",
    });

    expect(response.statusCode).toBe(403);
  });

  test("GET /products/{productId}", async () => {
    ddbMock
      .on(ScanCommand, {
        TableName: genericConfig.StoreInventoryTableName,
      })
      .resolvesOnce({
        Items: inventoryTableEntries,
      })
      .rejects();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/store/products/testing?ts=1",
    });

    expect(response.statusCode).toBe(403);
  });
});

describe("GET /products", () => {
  beforeEach(() => {
    (app as any).redisClient.flushall();
    ddbMock.reset();
    sqsMock.reset();
    smMock.reset();
    vi.clearAllMocks();
  });

  test("Gets all open products", async () => {
    ddbMock
      .on(ScanCommand, {
        TableName: genericConfig.StoreInventoryTableName,
      })
      .resolvesOnce({
        Items: inventoryTableEntries,
      })
      .rejects();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/store/products",
    });

    expect(response.statusCode).toBe(200);
    const responseJson = response.json();
    expect(responseJson).toEqual({
      products: [
        {
          productId: "testing",
          name: "Testing product",
          verifiedIdentityRequired: true,
          variants: [
            {
              variantId: "73b050da-e6f5-48bd-a389-861ef9c975f1",
              name: "Large",
              memberLists: [""],
              exchangesAllowed: true,
              inventoryCount: 20,
            },
            {
              variantId: "c4981d77-8f1b-48f1-9be9-8e69ed7bd3e2",
              name: "Small",
              memberLists: ["acmpaid"],
              inventoryCount: 18,
              exchangesAllowed: true,
            },
          ],
          description: "A product used solely for testing.",
          inventoryMode: "PER_VARIANT",
          openAt: 0,
          closeAt: 1895688984,
          limitConfiguration: { limitType: "PER_PRODUCT", maxQuantity: 4 },
        },
      ],
    });
    expect(response.headers["cache-control"]).toContain("public");
    expect(response.headers["cache-control"]).toContain("max-age=30");
  });
});

describe("GET /products/{productId}", () => {
  beforeEach(() => {
    (app as any).redisClient.flushall();
    ddbMock.reset();
    sqsMock.reset();
    smMock.reset();
    vi.clearAllMocks();
  });

  test("Gets specific product", async () => {
    ddbMock
      .on(QueryCommand, {
        TableName: genericConfig.StoreInventoryTableName,
        KeyConditionExpression: "productId = :pid",
        ExpressionAttributeValues: marshall({ ":pid": "testing" }),
      })
      .resolvesOnce({
        Items: [
          testingProductDefinition,
          testingProductLargeVariant,
          testingProductSmallVariant,
        ],
      })
      .rejects();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/store/products/testing",
    });

    expect(response.statusCode).toBe(200);
    const responseJson = response.json();
    expect(responseJson).toEqual({
      productId: "testing",
      name: "Testing product",
      verifiedIdentityRequired: true,
      variants: [
        {
          variantId: "73b050da-e6f5-48bd-a389-861ef9c975f1",
          name: "Large",
          memberLists: [""],
          exchangesAllowed: true,
          inventoryCount: 20,
        },
        {
          variantId: "c4981d77-8f1b-48f1-9be9-8e69ed7bd3e2",
          name: "Small",
          memberLists: ["acmpaid"],
          exchangesAllowed: true,
          inventoryCount: 18,
        },
      ],
      description: "A product used solely for testing.",
      openAt: 0,
      closeAt: 1895688984,
      inventoryMode: "PER_VARIANT",
      limitConfiguration: { limitType: "PER_PRODUCT", maxQuantity: 4 },
    });
    expect(response.headers["cache-control"]).toContain("public");
    expect(response.headers["cache-control"]).toContain("max-age=30");
  });

  test("Denies request for closed product", async () => {
    ddbMock
      .on(QueryCommand, {
        TableName: genericConfig.StoreInventoryTableName,
        KeyConditionExpression: "productId = :pid",
        ExpressionAttributeValues: marshall({ ":pid": "closed" }),
      })
      .resolvesOnce({
        Items: [closedProductDefinition, closedProductOnlyVariant],
      })
      .rejects();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/store/products/closed",
    });

    expect(response.statusCode).toEqual(404);
  });
});

describe("POST /checkout", () => {
  beforeEach(() => {
    (app as any).redisClient.flushall();
    ddbMock.reset();
    sqsMock.reset();
    smMock.reset();
    vi.clearAllMocks();

    // Set up default mock return values after clearing
    mockCreateCheckoutSessionWithCustomer.mockResolvedValue(
      "https://checkout.stripe.com/test-session",
    );
    mockCreateCheckoutSession.mockResolvedValue(
      "https://checkout.stripe.com/test-session",
    );
  });

  test("Returns member price for paid member", async () => {
    // Mock verified identity for paid member
    mockVerifyUiucAccessToken.mockResolvedValue({
      userPrincipalName: "jd3@illinois.edu",
      givenName: "John",
      surname: "Doe",
      mail: "johndoe@gmail.com",
    });

    // Mock product definition lookup
    ddbMock
      .on(GetItemCommand, {
        TableName: genericConfig.StoreInventoryTableName,
        Key: marshall({ productId: "testing", variantId: DEFAULT_VARIANT_ID }),
      })
      .resolves({
        Item: testingProductDefinition,
      });

    // Mock variant lookup
    ddbMock
      .on(GetItemCommand, {
        TableName: genericConfig.StoreInventoryTableName,
        Key: marshall({
          productId: "testing",
          variantId: "c4981d77-8f1b-48f1-9be9-8e69ed7bd3e2",
        }),
      })
      .resolves({
        Item: testingProductSmallVariant,
      });

    // Mock limits check (no existing purchases)
    ddbMock
      .on(GetItemCommand, {
        TableName: genericConfig.StoreLimitsTableName,
      })
      .resolves({
        Item: undefined, // No existing limit record
      });

    // Mock user info lookup - paid member with Stripe customer ID
    ddbMock.on(BatchGetItemCommand).resolves({
      Responses: {
        [genericConfig.UserInfoTable]: [
          marshall({
            id: "jd3@illinois.edu",
            isPaidMember: true,
            stripeCustomerId: "cus_abc123",
          }),
        ],
      },
    });

    // Mock the transaction write for order creation
    ddbMock.on(TransactWriteItemsCommand).resolves({});

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/store/checkout",
      headers: {
        "x-uiuc-token": paidJwt,
        origin: "https://acm.illinois.edu",
        "x-turnstile-response": "a",
      },
      body: {
        items: [
          {
            productId: "testing",
            variantId: "c4981d77-8f1b-48f1-9be9-8e69ed7bd3e2",
            quantity: 1,
          },
        ],
        successRedirPath: "/",
        cancelRedirPath: "/",
      },
    });

    expect(response.statusCode).toBe(201);
    const responseJson = response.json();

    // Verify checkout URL is returned
    expect(responseJson.checkoutUrl).toBe(
      "https://checkout.stripe.com/test-session",
    );
    expect(responseJson.orderId).toBeDefined();

    // Verify the Stripe mock was called with the MEMBER price
    expect(mockCreateCheckoutSessionWithCustomer).toHaveBeenCalledTimes(1);
    expect(mockCreateCheckoutSessionWithCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "cus_abc123",
        items: expect.arrayContaining([
          expect.objectContaining({
            price: "price_1StwEfDGHrJxx3mKseBfRuHA",
            quantity: 1,
          }),
        ]),
        captureMethod: "manual",
      }),
    );

    const callArgs = mockCreateCheckoutSessionWithCustomer.mock.calls[0][0];
    expect(callArgs.items[0].price).toBe("price_1StwEfDGHrJxx3mKseBfRuHA");
  });

  test("Returns non-member price for non-paid member", async () => {
    // Mock verified identity for NON-paid member (different user)
    mockVerifyUiucAccessToken.mockResolvedValue({
      userPrincipalName: "nonmember1@illinois.edu",
      givenName: "Jane",
      surname: "Smith",
      mail: "janesmith@gmail.com",
    });

    // Mock product definition lookup
    ddbMock
      .on(GetItemCommand, {
        TableName: genericConfig.StoreInventoryTableName,
        Key: marshall({ productId: "testing", variantId: DEFAULT_VARIANT_ID }),
      })
      .resolves({ Item: testingProductDefinition });

    // Mock variant lookup
    ddbMock
      .on(GetItemCommand, {
        TableName: genericConfig.StoreInventoryTableName,
        Key: marshall({
          productId: "testing",
          variantId: "c4981d77-8f1b-48f1-9be9-8e69ed7bd3e2",
        }),
      })
      .resolves({ Item: testingProductSmallVariant });

    // Mock limits check (no existing purchases)
    ddbMock
      .on(GetItemCommand, {
        TableName: genericConfig.StoreLimitsTableName,
      })
      .resolves({ Item: undefined });

    // Non-paid member - no existing record or isPaidMember: false
    ddbMock.on(BatchGetItemCommand).resolves({
      Responses: {
        [genericConfig.UserInfoTable]: [],
      },
    });

    // Mock the transaction write for order creation
    ddbMock.on(TransactWriteItemsCommand).resolves({});

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/store/checkout",
      headers: {
        "x-uiuc-token": paidJwt,
        origin: "https://acm.illinois.edu",
        "x-turnstile-response": "a",
      },
      body: {
        items: [
          {
            productId: "testing",
            variantId: "c4981d77-8f1b-48f1-9be9-8e69ed7bd3e2",
            quantity: 1,
          },
        ],
        successRedirPath: "/",
        cancelRedirPath: "/",
      },
    });

    expect(response.statusCode).toBe(201);

    // Verify the Stripe mock was called with the NON-MEMBER price and no customer ID
    expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateCheckoutSession.mock.calls[0][0];
    expect(callArgs.items[0].price).toBe("price_1StwEfDGHrJxx3mKxM5XROvP");
  });
});
