import { expect, test, beforeEach, vi, describe } from "vitest";
import init from "../../src/api/server.js";
import { mockClient } from "aws-sdk-client-mock";
import {
  BatchGetItemCommand,
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
  TransactionCanceledException,
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
              memberPriceCents: 1000,
              nonmemberPriceCents: 1500,
            },
            {
              variantId: "c4981d77-8f1b-48f1-9be9-8e69ed7bd3e2",
              name: "Small",
              memberLists: ["acmpaid"],
              inventoryCount: 18,
              exchangesAllowed: true,
              memberPriceCents: 1000,
              nonmemberPriceCents: 1500,
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
          memberPriceCents: 1000,
          nonmemberPriceCents: 1500,
        },
        {
          variantId: "c4981d77-8f1b-48f1-9be9-8e69ed7bd3e2",
          name: "Small",
          memberLists: ["acmpaid"],
          exchangesAllowed: true,
          inventoryCount: 18,
          memberPriceCents: 1000,
          nonmemberPriceCents: 1500,
        },
      ],
      description: "A product used solely for testing.",
      openAt: 0,
      closeAt: 1895688984,
      inventoryMode: "PER_VARIANT",
      limitConfiguration: { limitType: "PER_PRODUCT", maxQuantity: 4 },
    });
    expect(response.headers["cache-control"]).not.toBeDefined();
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

describe("PATCH /admin/products/:productId", () => {
  beforeEach(() => {
    (app as any).redisClient.flushall();
    ddbMock.reset();
    sqsMock.reset();
    smMock.reset();
    vi.clearAllMocks();
  });

  test("Modifies product metadata successfully", async () => {
    ddbMock.on(TransactWriteItemsCommand).resolves({});

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/store/admin/products/testing",
      headers: {
        Authorization: `Bearer ${testJwt}`,
      },
      body: {
        name: "Updated Testing Product",
        description: "An updated description for testing.",
        openAt: 1000,
        closeAt: 2000000000,
      },
    });

    expect(response.statusCode).toBe(204);

    const transactCalls = ddbMock.commandCalls(TransactWriteItemsCommand);
    expect(transactCalls).toHaveLength(1);

    const transactItems = transactCalls[0].args[0].input.TransactItems;
    expect(transactItems).toBeDefined();
    expect(transactItems!.length).toBeGreaterThanOrEqual(1);

    // Verify the product update item
    const updateItem = transactItems?.find((item) => item.Update !== undefined);
    expect(updateItem).toBeDefined();
    expect(updateItem?.Update?.TableName).toBe(
      genericConfig.StoreInventoryTableName,
    );
    expect(updateItem?.Update?.Key).toEqual({
      productId: { S: "testing" },
      variantId: { S: "DEFAULT" },
    });
    expect(updateItem?.Update?.UpdateExpression).toContain("SET");
    expect(updateItem?.Update?.ExpressionAttributeNames).toEqual(
      expect.objectContaining({
        "#name": "name",
        "#description": "description",
        "#openAt": "openAt",
        "#closeAt": "closeAt",
      }),
    );
    expect(updateItem?.Update?.ExpressionAttributeValues).toEqual(
      expect.objectContaining({
        ":name": { S: "Updated Testing Product" },
        ":description": { S: "An updated description for testing." },
        ":openAt": { N: "1000" },
        ":closeAt": { N: "2000000000" },
      }),
    );

    const auditLogItem = transactItems?.find(
      (item) =>
        item.Put !== undefined &&
        item.Put.TableName === genericConfig.AuditLogTable,
    );
    expect(auditLogItem).toBeDefined();
    expect(auditLogItem?.Put?.Item).toEqual(
      expect.objectContaining({
        module: { S: "store" },
        target: { S: "testing" },
      }),
    );
    const auditMessage = auditLogItem?.Put?.Item?.message?.S;
    expect(auditMessage).toBeDefined();
    expect(auditMessage).toContain("Modified product metadata fields");
    expect(auditMessage).toContain("name");
    expect(auditMessage).toContain("description");
    expect(auditMessage).toContain("openAt");
    expect(auditMessage).toContain("closeAt");
  });

  test("Modifies single field successfully", async () => {
    ddbMock.on(TransactWriteItemsCommand).resolves({});

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/store/admin/products/testing",
      headers: {
        Authorization: `Bearer ${testJwt}`,
      },
      body: {
        name: "New Product Name",
      },
    });

    expect(response.statusCode).toBe(204);

    const transactCalls = ddbMock.commandCalls(TransactWriteItemsCommand);
    expect(transactCalls).toHaveLength(1);

    const transactItems = transactCalls[0].args[0].input.TransactItems;

    // Verify only the name field is being updated
    const updateItem = transactItems?.find((item) => item.Update !== undefined);
    expect(updateItem?.Update?.ExpressionAttributeNames).toEqual(
      expect.objectContaining({
        "#name": "name",
      }),
    );
    expect(updateItem?.Update?.ExpressionAttributeValues).toEqual(
      expect.objectContaining({
        ":name": { S: "New Product Name" },
      }),
    );
    const auditLogItem = transactItems?.find(
      (item) =>
        item.Put !== undefined &&
        item.Put.TableName === genericConfig.AuditLogTable,
    );
    expect(auditLogItem).toBeDefined();
    const auditMessage = auditLogItem?.Put?.Item?.message?.S;
    expect(auditMessage).toBeDefined();
    expect(auditMessage).toContain("name");
    expect(auditMessage).not.toContain("description");
    expect(auditMessage).not.toContain("openAt");
    expect(auditMessage).not.toContain("closeAt");
  });

  test("Modifies limit configuration successfully", async () => {
    ddbMock.on(TransactWriteItemsCommand).resolves({});

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/store/admin/products/testing",
      headers: {
        Authorization: `Bearer ${testJwt}`,
      },
      body: {
        limitConfiguration: {
          limitType: "PER_VARIANT",
          maxQuantity: 10,
        },
      },
    });

    expect(response.statusCode).toBe(204);

    const transactCalls = ddbMock.commandCalls(TransactWriteItemsCommand);
    const transactItems = transactCalls[0].args[0].input.TransactItems;

    const updateItem = transactItems?.find((item) => item.Update !== undefined);
    expect(updateItem?.Update?.ExpressionAttributeNames).toEqual(
      expect.objectContaining({
        "#limitConfiguration": "limitConfiguration",
      }),
    );
    // marshall() produces the DynamoDB format directly without wrapping in M:
    expect(updateItem?.Update?.ExpressionAttributeValues).toEqual(
      expect.objectContaining({
        ":limitConfiguration": {
          limitType: { S: "PER_VARIANT" },
          maxQuantity: { N: "10" },
        },
      }),
    );
    const auditLogItem = transactItems?.find(
      (item) =>
        item.Put !== undefined &&
        item.Put.TableName === genericConfig.AuditLogTable,
    );
    expect(auditLogItem).toBeDefined();
    expect(auditLogItem?.Put?.Item?.message?.S).toContain("limitConfiguration");
  });

  test("Modifies verifiedIdentityRequired successfully", async () => {
    ddbMock.on(TransactWriteItemsCommand).resolves({});

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/store/admin/products/testing",
      headers: {
        Authorization: `Bearer ${testJwt}`,
      },
      body: {
        verifiedIdentityRequired: false,
      },
    });

    expect(response.statusCode).toBe(204);

    const transactCalls = ddbMock.commandCalls(TransactWriteItemsCommand);
    const transactItems = transactCalls[0].args[0].input.TransactItems;

    const updateItem = transactItems?.find((item) => item.Update !== undefined);
    expect(updateItem?.Update?.ExpressionAttributeValues).toEqual(
      expect.objectContaining({
        ":verifiedIdentityRequired": { BOOL: false },
      }),
    );
    const auditLogItem = transactItems?.find(
      (item) =>
        item.Put !== undefined &&
        item.Put.TableName === genericConfig.AuditLogTable,
    );
    expect(auditLogItem).toBeDefined();
    expect(auditLogItem?.Put?.Item?.message?.S).toContain(
      "verifiedIdentityRequired",
    );
  });

  test("Returns 403 without authentication", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/store/admin/products/testing",
      body: {
        name: "Updated Name",
      },
    });

    expect(response.statusCode).toBe(403);

    // Verify no DynamoDB calls were made
    const transactCalls = ddbMock.commandCalls(TransactWriteItemsCommand);
    expect(transactCalls).toHaveLength(0);
  });
});

describe("POST /admin/orders/:orderId/fulfill", () => {
  beforeEach(() => {
    (app as any).redisClient.flushall();
    ddbMock.reset();
    sqsMock.reset();
    smMock.reset();
    vi.clearAllMocks();
  });

  test("Fulfills line items successfully", async () => {
    ddbMock.on(TransactWriteItemsCommand).resolves({});

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/store/admin/orders/order-123/fulfill",
      headers: {
        Authorization: `Bearer ${testJwt}`,
      },
      body: {
        lineItemIds: ["line-item-1", "line-item-2"],
      },
    });

    expect(response.statusCode).toBe(204);

    const transactCalls = ddbMock.commandCalls(TransactWriteItemsCommand);
    expect(transactCalls).toHaveLength(1);

    const transactItems = transactCalls[0].args[0].input.TransactItems;
    expect(transactItems).toBeDefined();
    expect(transactItems!.length).toBe(4); // 1 conditional check on order + 2 line items + 1 audit log

    // Verify condition check on active order
    const conditionalItem = transactItems?.find(
      (item) => item.ConditionCheck !== undefined,
    );
    expect(conditionalItem?.ConditionCheck).toEqual({
      TableName: genericConfig.StoreCartsOrdersTableName,
      Key: {
        orderId: { S: "order-123" },
        lineItemId: { S: "ORDER" },
      },
      ConditionExpression: "#status = :active",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":active": { S: "ACTIVE" },
      },
    });

    // Verify first line item update
    const firstUpdate = transactItems?.find(
      (item) =>
        item.Update !== undefined &&
        item.Update.Key?.lineItemId?.S === "line-item-1",
    );
    expect(firstUpdate).toBeDefined();
    expect(firstUpdate?.Update?.TableName).toBe(
      genericConfig.StoreCartsOrdersTableName,
    );
    expect(firstUpdate?.Update?.Key).toEqual({
      orderId: { S: "order-123" },
      lineItemId: { S: "line-item-1" },
    });
    expect(firstUpdate?.Update?.UpdateExpression).toContain(
      "SET #isFulfilled = :isFulfilled",
    );
    expect(firstUpdate?.Update?.ConditionExpression).toBe(
      "attribute_exists(orderId) AND attribute_exists(lineItemId) AND (#isFulfilled = :notFulfilled OR attribute_not_exists(#isFulfilled))",
    );
    expect(firstUpdate?.Update?.ExpressionAttributeValues).toEqual(
      expect.objectContaining({
        ":isFulfilled": { BOOL: true },
      }),
    );

    // Verify second line item update
    const secondUpdate = transactItems?.find(
      (item) =>
        item.Update !== undefined &&
        item.Update.Key?.lineItemId?.S === "line-item-2",
    );
    expect(secondUpdate).toBeDefined();
    expect(secondUpdate?.Update?.Key).toEqual({
      orderId: { S: "order-123" },
      lineItemId: { S: "line-item-2" },
    });

    // Verify audit log entry
    const auditLogItem = transactItems?.find(
      (item) =>
        item.Put !== undefined &&
        item.Put.TableName === genericConfig.AuditLogTable,
    );
    expect(auditLogItem).toBeDefined();
    expect(auditLogItem?.Put?.Item).toEqual(
      expect.objectContaining({
        module: { S: "store" },
        target: { S: "order-123" },
      }),
    );
    const auditMessage = auditLogItem?.Put?.Item?.message?.S;
    expect(auditMessage).toBeDefined();
    expect(auditMessage).toContain("Fulfilled line items");
    expect(auditMessage).toContain("line-item-1");
    expect(auditMessage).toContain("line-item-2");
  });

  test("Fulfills single line item successfully", async () => {
    ddbMock.on(TransactWriteItemsCommand).resolves({});

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/store/admin/orders/order-456/fulfill",
      headers: {
        Authorization: `Bearer ${testJwt}`,
      },
      body: {
        lineItemIds: ["single-line-item"],
      },
    });

    expect(response.statusCode).toBe(204);

    const transactCalls = ddbMock.commandCalls(TransactWriteItemsCommand);
    expect(transactCalls).toHaveLength(1);

    const transactItems = transactCalls[0].args[0].input.TransactItems;
    expect(transactItems!.length).toBe(3); // 1 conditional check + 1 line item + 1 audit log

    const conditionalItem = transactItems?.find(
      (item) => item.ConditionCheck !== undefined,
    );
    expect(conditionalItem?.ConditionCheck).toEqual({
      TableName: genericConfig.StoreCartsOrdersTableName,
      Key: {
        orderId: { S: "order-456" },
        lineItemId: { S: "ORDER" },
      },
      ConditionExpression: "#status = :active",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":active": { S: "ACTIVE" },
      },
    });

    const updateItem = transactItems?.find((item) => item.Update !== undefined);
    expect(updateItem?.Update?.Key).toEqual({
      orderId: { S: "order-456" },
      lineItemId: { S: "single-line-item" },
    });
  });

  test("Returns 400 when line items do not exist", async () => {
    const cancellationReasons = [
      { Code: "None" },
      { Code: "ConditionalCheckFailed" },
      { Code: "None" },
      { Code: "ConditionalCheckFailed" },
    ];
    const error = new TransactionCanceledException({
      message: "Transaction cancelled",
      $metadata: {},
      CancellationReasons: cancellationReasons,
    });
    ddbMock.on(TransactWriteItemsCommand).rejects(error);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/store/admin/orders/order-789/fulfill",
      headers: {
        Authorization: `Bearer ${testJwt}`,
      },
      body: {
        lineItemIds: ["nonexistent-1", "existing-1", "nonexistent-2"],
      },
    });

    expect(response.statusCode).toBe(400);
    const responseJson = response.json();
    expect(responseJson.message).toContain(
      "Line items are not in a fulfillable state: nonexistent-1, nonexistent-2",
    );
    expect(responseJson.message).toContain("nonexistent-1");
    expect(responseJson.message).toContain("nonexistent-2");
  });

  test("Returns 400 when order is not in ACTIVE state", async () => {
    const cancellationReasons = [
      { Code: "ConditionalCheckFailed" },
      { Code: "None" },
      { Code: "None" },
      { Code: "None" },
    ];
    const error = new TransactionCanceledException({
      message: "Transaction cancelled",
      $metadata: {},
      CancellationReasons: cancellationReasons,
    });
    ddbMock.on(TransactWriteItemsCommand).rejects(error);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/store/admin/orders/order-789/fulfill",
      headers: {
        Authorization: `Bearer ${testJwt}`,
      },
      body: {
        lineItemIds: ["existing-1"],
      },
    });

    expect(response.statusCode).toBe(400);
    const responseJson = response.json();
    expect(responseJson.message).toStrictEqual(
      "Order is not active and cannot be modified",
    );
  });

  test("Returns 403 without authentication", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/store/admin/orders/order-123/fulfill",
      body: {
        lineItemIds: ["line-item-1"],
      },
    });

    expect(response.statusCode).toBe(403);

    // Verify no DynamoDB calls were made
    const transactCalls = ddbMock.commandCalls(TransactWriteItemsCommand);
    expect(transactCalls).toHaveLength(0);
  });

  test("Returns 400 with duplicates in lineItemIds array", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/store/admin/orders/order-123/fulfill",
      headers: {
        Authorization: `Bearer ${testJwt}`,
      },
      body: {
        lineItemIds: ["e1", "e1"],
      },
    });

    expect(response.statusCode).toBe(400);

    // Verify no DynamoDB calls were made
    const transactCalls = ddbMock.commandCalls(TransactWriteItemsCommand);
    expect(transactCalls).toHaveLength(0);
  });
});
