// TODO: Not testing stripe yet

// tests/unit/store.test.ts
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DynamoDBClient,
  TransactGetItemsCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

// testing functions
import { checkItemSellable } from "../../src/api/functions/store.js";

import { genericConfig } from "../../src/common/config.js";

const ddbMock = mockClient(DynamoDBClient);

class FakeRedis {
  store = new Map<string, string>();
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async set(key: string, val: string) {
    this.store.set(key, val);
  }
  async flushdb() {
    this.store.clear();
  }
}
const redis = new FakeRedis();

// mock membership module
vi.mock("../../src/api/functions/membership.js", () => {
  return {
    checkExternalMembership: vi.fn().mockResolvedValue(false),
    checkPaidMembershipFromTable: vi.fn().mockResolvedValue(false),
  };
});

// Test Constants
const nowSec = Math.floor(Date.now() / 1000);
// product/variant
const productId = "sweatshirt_2025";
const variantId = "large";

// price
const MEMBER_PRICE_ID = "price_member_123";
const NONMEMBER_PRICE_ID = "price_nonmember_456";

// limit id
const LIMIT_ID_PRODUCT = productId;
const LIMIT_ID_VARIANT = `${productId}#${variantId}`;

const INVENTORY_TABLE = genericConfig.StoreInventoryTableName;
const LIMITS_TABLE = genericConfig.StoreLimitsTableName;

// Helpers
function mockGetItemForLimits({
  quantitiesByLimitId,
}: {
  quantitiesByLimitId: Record<string, number>;
}) {
  ddbMock.on(GetItemCommand).callsFake((cmd: any) => {
    if (cmd.TableName !== LIMITS_TABLE) {
      return Promise.reject(new Error("Unexpected table in GetItem"));
    }
    const key = unmarshall(cmd.Key!);
    const limitId = key.limitId as string;
    const email = key.userId as string;
    if (email && limitId && limitId in quantitiesByLimitId) {
      return Promise.resolve({
        Item: marshall({
          userId: email.toLowerCase(),
          limitId: limitId,
          quantity: quantitiesByLimitId[limitId],
        }),
      });
    }
    return Promise.resolve({}); // no record -> 0
  });
}

// Helpers
function mockTransactGetDefaultAndVariant({
  openAt,
  inventoryCount,
  soldCount,
  memberLists = ["acmpaid"],
  memberPriceId = MEMBER_PRICE_ID,
  nonmemberPriceId = NONMEMBER_PRICE_ID,
  limitType, // "per_variant" | "per_product" | undefined
  limitQty, // number | undefined
}: {
  openAt: number;
  inventoryCount: number;
  soldCount: number;
  memberLists?: string[];
  memberPriceId?: string;
  nonmemberPriceId?: string;
  limitType?: "per_variant" | "per_product";
  limitQty?: number;
}) {
  ddbMock.on(TransactGetItemsCommand).callsFake((cmd: any) => {
    if (cmd.TransactItems?.length !== 2) {
      return Promise.reject(new Error("Expected 2 items in TransactGet"));
    }
    const [defGet, varGet] = cmd.TransactItems;
    const defKey = unmarshall(defGet!.Get!.Key!);
    const varKey = unmarshall(varGet!.Get!.Key!);

    if (
      defGet!.Get!.TableName !== INVENTORY_TABLE ||
      varGet!.Get!.TableName !== INVENTORY_TABLE
    ) {
      return Promise.reject(new Error("Wrong table in TransactGet"));
    }
    if (
      defKey.productId !== productId ||
      defKey.variantId !== "DEFAULT" ||
      varKey.productId !== productId ||
      varKey.variantId !== variantId
    ) {
      return Promise.reject(new Error("Key mismatch in TransactGet"));
    }

    const defItem = {
      productId: productId,
      variantId: "DEFAULT",
      openAt: openAt,
      name: "ACM Sweatshirt 2025",
    };

    const varItem: any = {
      productId: productId,
      variantId: variantId,
      inventoryCount: inventoryCount,
      soldCount: soldCount,
      memberLists: memberLists,
      memberPriceId: memberPriceId,
      nonmemberPriceId: nonmemberPriceId,
    };
    if (limitType && typeof limitQty === "number") {
      varItem.limitConfiguration = { type: limitType, quantity: limitQty };
    }

    return Promise.resolve({
      Responses: [{ Item: marshall(defItem) }, { Item: marshall(varItem) }],
    });
  });
}

// Tests

describe("checkItemSellable", () => {
  beforeEach(async () => {
    ddbMock.reset();
    await redis.flushdb();
    vi.clearAllMocks();
  });
  afterEach(async () => {
    ddbMock.reset();
    await redis.flushdb();
  });

  test("member found: returns member_price_id", async () => {
    // Dynamo
    mockTransactGetDefaultAndVariant({
      openAt: nowSec - 100,
      inventoryCount: 10,
      soldCount: 5,
      memberLists: ["acmpaid", "built"],
      limitType: "per_variant",
      limitQty: 2,
    });
    mockGetItemForLimits({
      quantitiesByLimitId: { [LIMIT_ID_VARIANT]: 1 },
    });
    // Redis: acmpaid
    await redis.set(
      `membership:tester:acmpaid`,
      JSON.stringify({ isMember: true }),
    );

    const priceId = await checkItemSellable({
      userId: "tester@illinois.edu",
      productId,
      variantId,
      dynamoClient: new DynamoDBClient({}),
      redisClient: redis as any,
    });
    expect(priceId).toBe(MEMBER_PRICE_ID);
  });

  test("non-member: returns nonmember_price_id", async () => {
    mockTransactGetDefaultAndVariant({
      openAt: nowSec - 100,
      inventoryCount: 10,
      soldCount: 0,
      memberLists: ["acmpaid", "built"],
      limitType: "per_variant",
      limitQty: 2,
    });
    mockGetItemForLimits({
      quantitiesByLimitId: { [LIMIT_ID_VARIANT]: 0 },
    });
    // Redis not hitting
    // membership mocks (checkPaidMembershipFromTable / default false)
    const priceId = await checkItemSellable({
      userId: "nomember@illinois.edu",
      productId,
      variantId,
      dynamoClient: new DynamoDBClient({}),
      redisClient: redis as any,
    });
    expect(priceId).toBe(NONMEMBER_PRICE_ID);
  });

  test("not yet open for sale: returns null", async () => {
    mockTransactGetDefaultAndVariant({
      openAt: nowSec + 3600,
      inventoryCount: 10,
      soldCount: 0,
    });
    mockGetItemForLimits({ quantitiesByLimitId: {} });

    const priceId = await checkItemSellable({
      userId: "tester@illinois.edu",
      productId,
      variantId,
      dynamoClient: new DynamoDBClient({}),
      redisClient: redis as any,
    });
    expect(priceId).toBeNull();
  });

  test("insufficient inventory: returns null", async () => {
    mockTransactGetDefaultAndVariant({
      openAt: nowSec - 100,
      inventoryCount: 5,
      soldCount: 5,
    });
    mockGetItemForLimits({ quantitiesByLimitId: {} });

    const priceId = await checkItemSellable({
      userId: "tester@illinois.edu",
      productId,
      variantId,
      dynamoClient: new DynamoDBClient({}),
      redisClient: redis as any,
    });
    expect(priceId).toBeNull();
  });

  test("exceeds limit (per_variant): returns null", async () => {
    mockTransactGetDefaultAndVariant({
      openAt: nowSec - 10,
      inventoryCount: 10,
      soldCount: 1,
      limitType: "per_variant",
      limitQty: 1,
    });
    // Should can not buy
    mockGetItemForLimits({
      quantitiesByLimitId: { [LIMIT_ID_VARIANT]: 1 },
    });

    const priceId = await checkItemSellable({
      userId: "tester@illinois.edu",
      productId,
      variantId,
      dynamoClient: new DynamoDBClient({}),
      redisClient: redis as any,
    });
    expect(priceId).toBeNull();
  });

  test("exceeds limit (per_product): returns null", async () => {
    mockTransactGetDefaultAndVariant({
      openAt: nowSec - 10,
      inventoryCount: 10,
      soldCount: 1,
      limitType: "per_product",
      limitQty: 2,
    });
    // per_product usage=2, limit=2 → cannot buy more
    mockGetItemForLimits({
      quantitiesByLimitId: { [LIMIT_ID_PRODUCT]: 2 },
    });

    const priceId = await checkItemSellable({
      userId: "tester@illinois.edu",
      productId,
      variantId,
      dynamoClient: new DynamoDBClient({}),
      redisClient: redis as any,
    });
    expect(priceId).toBeNull();
  });
});
