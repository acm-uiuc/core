// TODO: Not testing stripe yet
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DynamoDBClient,
  TransactGetItemsCommand,
  GetItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  checkItemSellable,
  createCheckoutSessionAndPersistCart,
} from "../../src/api/functions/store.js";
import { genericConfig } from "../../src/common/config.js";
import {
  checkExternalMembership,
  checkPaidMembershipFromTable,
} from "../../src/api/functions/membership.js";

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

vi.mock("../../src/api/functions/membership.js", () => ({
  checkExternalMembership: vi.fn().mockResolvedValue(false),
  checkPaidMembershipFromTable: vi.fn().mockResolvedValue(false),
}));

vi.mock("../../src/api/functions/stripe.js", () => ({
  createCheckoutSession: vi
    .fn()
    .mockResolvedValue("https://stripe.example/checkout/session"),
}));

const nowSec = Math.floor(Date.now() / 1000);
const productId = "sweatshirt_2025";
const variantId = "large";
const MEMBER_PRICE_ID = "price_member_123";
const NONMEMBER_PRICE_ID = "price_nonmember_456";
const LIMIT_ID_PRODUCT = productId;
const LIMIT_ID_VARIANT = `${productId}#${variantId}`;
const INVENTORY_TABLE = genericConfig.StoreInventoryTableName;
const LIMITS_TABLE = genericConfig.StoreLimitsTableName;

async function expectRejectName(p: Promise<any>, name: string) {
  await expect(p).rejects.toHaveProperty("name", name);
}

function mockGetItemForLimits({
  quantitiesByLimitId,
}: {
  quantitiesByLimitId: Record<string, number | string>;
}) {
  ddbMock.on(GetItemCommand).callsFake((cmd: any) => {
    if (cmd.TableName !== LIMITS_TABLE)
      return Promise.reject(new Error("Unexpected table in GetItem"));
    const key = unmarshall(cmd.Key!);
    const limitId = key.limitId as string;
    const email = key.userId as string;
    if (email && limitId && limitId in quantitiesByLimitId) {
      return Promise.resolve({
        Item: marshall({
          userId: email.toLowerCase(),
          limitId,
          quantity: quantitiesByLimitId[limitId],
        }),
      });
    }
    return Promise.resolve({});
  });
}

function mockTransactGetDefaultAndVariant({
  openAt,
  inventoryCount,
  soldCount,
  memberLists = ["acmpaid"],
  memberPriceId = MEMBER_PRICE_ID,
  nonmemberPriceId = NONMEMBER_PRICE_ID,
  limitType,
  limitQty,
}: {
  openAt: number | undefined;
  inventoryCount: any;
  soldCount: any;
  memberLists?: string[];
  memberPriceId?: string;
  nonmemberPriceId?: string;
  limitType?: "per_variant" | "per_product";
  limitQty?: number;
}) {
  ddbMock.on(TransactGetItemsCommand).callsFake((cmd: any) => {
    if (cmd.TransactItems?.length !== 2)
      return Promise.reject(new Error("Expected 2 items in TransactGet"));
    const [defGet, varGet] = cmd.TransactItems;
    const defKey = unmarshall(defGet!.Get!.Key!);
    const varKey = unmarshall(varGet!.Get!.Key!);

    if (
      defGet!.Get!.TableName !== INVENTORY_TABLE ||
      varGet!.Get!.TableName !== INVENTORY_TABLE
    )
      return Promise.reject(new Error("Wrong table in TransactGet"));
    if (
      defKey.productId !== productId ||
      defKey.variantId !== "DEFAULT" ||
      varKey.productId !== productId ||
      varKey.variantId !== variantId
    )
      return Promise.reject(new Error("Key mismatch in TransactGet"));

    const defItem: any = {
      productId,
      variantId: "DEFAULT",
      name: "ACM Sweatshirt 2025",
    };
    if (typeof openAt === "number") defItem.openAt = openAt;

    const varItem: any = {
      productId,
      variantId,
      memberLists,
      memberPriceId,
      nonmemberPriceId,
    };
    if (typeof inventoryCount !== "undefined")
      varItem.inventoryCount = inventoryCount;
    if (typeof soldCount !== "undefined") varItem.soldCount = soldCount;
    if (limitType && typeof limitQty === "number")
      varItem.limitConfiguration = { type: limitType, quantity: limitQty };

    return Promise.resolve({
      Responses: [{ Item: marshall(defItem) }, { Item: marshall(varItem) }],
    });
  });
}

function mockTransactGetWithMissing({
  missingDef = false,
  missingVar = false,
  base = {},
}: {
  missingDef?: boolean;
  missingVar?: boolean;
  base?: Partial<{
    openAt: number | undefined;
    inventoryCount: any;
    soldCount: any;
    memberLists: string[];
    memberPriceId: string;
    nonmemberPriceId: string;
  }>;
}) {
  const {
    openAt,
    inventoryCount = 10,
    soldCount = 0,
    memberLists = [],
    memberPriceId = MEMBER_PRICE_ID,
    nonmemberPriceId = NONMEMBER_PRICE_ID,
  } = base;

  ddbMock.on(TransactGetItemsCommand).callsFake((_cmd: any) => {
    const responses: any[] = [];

    if (!missingDef) {
      const defItem: any = { productId, variantId: "DEFAULT" };
      if (typeof openAt === "number") defItem.openAt = openAt;
      responses.push({ Item: marshall(defItem) });
    } else responses.push({});

    if (!missingVar) {
      const varItem: any = {
        productId,
        variantId,
        memberLists,
        memberPriceId,
        nonmemberPriceId,
      };
      if (typeof inventoryCount !== "undefined")
        varItem.inventoryCount = inventoryCount;
      if (typeof soldCount !== "undefined") varItem.soldCount = soldCount;
      responses.push({ Item: marshall(varItem) });
    } else responses.push({});

    return Promise.resolve({ Responses: responses });
  });
}

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

  test("member found: returns member price", async () => {
    mockTransactGetDefaultAndVariant({
      openAt: nowSec - 100,
      inventoryCount: 10,
      soldCount: 5,
      memberLists: ["acmpaid", "built"],
      limitType: "per_variant",
      limitQty: 2,
    });
    mockGetItemForLimits({ quantitiesByLimitId: { [LIMIT_ID_VARIANT]: 1 } });
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

  test("non-member: returns nonmember price", async () => {
    mockTransactGetDefaultAndVariant({
      openAt: nowSec - 100,
      inventoryCount: 10,
      soldCount: 0,
      memberLists: ["acmpaid", "built"],
      limitType: "per_variant",
      limitQty: 2,
    });
    mockGetItemForLimits({ quantitiesByLimitId: { [LIMIT_ID_VARIANT]: 0 } });
    const priceId = await checkItemSellable({
      userId: "nomember@illinois.edu",
      productId,
      variantId,
      dynamoClient: new DynamoDBClient({}),
      redisClient: redis as any,
    });
    expect(priceId).toBe(NONMEMBER_PRICE_ID);
  });

  test("not yet open for sale -> StoreItemNotSellTimeError", async () => {
    mockTransactGetDefaultAndVariant({
      openAt: nowSec + 3600,
      inventoryCount: 10,
      soldCount: 0,
    });
    mockGetItemForLimits({ quantitiesByLimitId: {} });
    await expectRejectName(
      checkItemSellable({
        userId: "tester@illinois.edu",
        productId,
        variantId,
        dynamoClient: new DynamoDBClient({}),
        redisClient: redis as any,
      }),
      "StoreItemNotSellTimeError",
    );
  });

  test("insufficient inventory -> StoreItemOutOfStockError", async () => {
    mockTransactGetDefaultAndVariant({
      openAt: nowSec - 100,
      inventoryCount: 5,
      soldCount: 5,
    });
    mockGetItemForLimits({ quantitiesByLimitId: {} });
    await expectRejectName(
      checkItemSellable({
        userId: "tester@illinois.edu",
        productId,
        variantId,
        dynamoClient: new DynamoDBClient({}),
        redisClient: redis as any,
      }),
      "StoreItemOutOfStockError",
    );
  });

  test("exceeds limit (per_variant) -> StoreItemPurchaseLimitExceededError", async () => {
    mockTransactGetDefaultAndVariant({
      openAt: nowSec - 10,
      inventoryCount: 10,
      soldCount: 1,
      limitType: "per_variant",
      limitQty: 1,
    });
    mockGetItemForLimits({ quantitiesByLimitId: { [LIMIT_ID_VARIANT]: 1 } });
    await expectRejectName(
      checkItemSellable({
        userId: "tester@illinois.edu",
        productId,
        variantId,
        dynamoClient: new DynamoDBClient({}),
        redisClient: redis as any,
      }),
      "StoreItemPurchaseLimitExceededError",
    );
  });

  test("exceeds limit (per_product) -> StoreItemPurchaseLimitExceededError", async () => {
    mockTransactGetDefaultAndVariant({
      openAt: nowSec - 10,
      inventoryCount: 10,
      soldCount: 1,
      limitType: "per_product",
      limitQty: 2,
    });
    mockGetItemForLimits({ quantitiesByLimitId: { [LIMIT_ID_PRODUCT]: 2 } });
    await expectRejectName(
      checkItemSellable({
        userId: "tester@illinois.edu",
        productId,
        variantId,
        dynamoClient: new DynamoDBClient({}),
        redisClient: redis as any,
      }),
      "StoreItemPurchaseLimitExceededError",
    );
  });

  test("missing DEFAULT(def) -> StoreItemNotFoundError", async () => {
    mockTransactGetWithMissing({
      missingDef: true,
      base: { inventoryCount: 10, soldCount: 0 },
    });
    mockGetItemForLimits({ quantitiesByLimitId: {} });
    await expectRejectName(
      checkItemSellable({
        userId: "x@illinois.edu",
        productId,
        variantId,
        dynamoClient: new DynamoDBClient({}),
        redisClient: redis as any,
      }),
      "StoreItemNotFoundError",
    );
  });

  test("missing VAR -> StoreItemNotFoundError", async () => {
    mockTransactGetWithMissing({
      missingVar: true,
      base: { openAt: nowSec - 100 },
    });
    mockGetItemForLimits({ quantitiesByLimitId: {} });
    await expectRejectName(
      checkItemSellable({
        userId: "x@illinois.edu",
        productId,
        variantId,
        dynamoClient: new DynamoDBClient({}),
        redisClient: redis as any,
      }),
      "StoreItemNotFoundError",
    );
  });

  test("openAt undefined + valid stock -> nonmember price", async () => {
    mockTransactGetDefaultAndVariant({
      openAt: undefined,
      inventoryCount: 10,
      soldCount: 0,
      memberLists: [],
    });
    mockGetItemForLimits({ quantitiesByLimitId: {} });
    const priceId = await checkItemSellable({
      userId: "y@illinois.edu",
      productId,
      variantId,
      dynamoClient: new DynamoDBClient({}),
      redisClient: redis as any,
    });
    expect(priceId).toBe(NONMEMBER_PRICE_ID);
  });

  test("soldCount undefined treated as 0 -> nonmember price", async () => {
    mockTransactGetDefaultAndVariant({
      openAt: nowSec - 100,
      inventoryCount: 3,
      soldCount: undefined as any,
      memberLists: [],
    });
    mockGetItemForLimits({ quantitiesByLimitId: {} });
    const priceId = await checkItemSellable({
      userId: "z@illinois.edu",
      productId,
      variantId,
      dynamoClient: new DynamoDBClient({}),
      redisClient: redis as any,
    });
    expect(priceId).toBe(NONMEMBER_PRICE_ID);
  });

  test("inventoryCount null -> StoreItemOutOfStockError", async () => {
    mockTransactGetDefaultAndVariant({
      openAt: nowSec - 100,
      inventoryCount: null as any,
      soldCount: 0,
    });
    mockGetItemForLimits({ quantitiesByLimitId: {} });
    await expectRejectName(
      checkItemSellable({
        userId: "b@illinois.edu",
        productId,
        variantId,
        dynamoClient: new DynamoDBClient({}),
        redisClient: redis as any,
      }),
      "StoreItemOutOfStockError",
    );
  });

  test("soldCount > inventoryCount -> StoreItemOutOfStockError", async () => {
    mockTransactGetDefaultAndVariant({
      openAt: nowSec - 100,
      inventoryCount: 2,
      soldCount: 5,
    });
    mockGetItemForLimits({ quantitiesByLimitId: {} });
    await expectRejectName(
      checkItemSellable({
        userId: "c@illinois.edu",
        productId,
        variantId,
        dynamoClient: new DynamoDBClient({}),
        redisClient: redis as any,
      }),
      "StoreItemOutOfStockError",
    );
  });

  test("limit quantity = 0 -> ignore -> nonmember price", async () => {
    mockTransactGetDefaultAndVariant({
      openAt: nowSec - 100,
      inventoryCount: 10,
      soldCount: 0,
      limitType: "per_variant",
      limitQty: 0,
      memberLists: [],
    });
    mockGetItemForLimits({ quantitiesByLimitId: { [LIMIT_ID_VARIANT]: 999 } });
    const priceId = await checkItemSellable({
      userId: "ignorelimit@illinois.edu",
      productId,
      variantId,
      dynamoClient: new DynamoDBClient({}),
      redisClient: redis as any,
    });
    expect(priceId).toBe(NONMEMBER_PRICE_ID);
  });

  test("negative limit quantity -> ignore -> nonmember price", async () => {
    mockTransactGetDefaultAndVariant({
      openAt: nowSec - 100,
      inventoryCount: 3,
      soldCount: 0,
      memberLists: [],
      limitType: "per_product",
      limitQty: -5 as any,
    });
    mockGetItemForLimits({ quantitiesByLimitId: { [LIMIT_ID_PRODUCT]: 100 } });
    const priceId = await checkItemSellable({
      userId: "neg@illinois.edu",
      productId,
      variantId,
      dynamoClient: new DynamoDBClient({}),
      redisClient: redis as any,
    });
    expect(priceId).toBe(NONMEMBER_PRICE_ID);
  });

  test("limits table returns string '2' and limit=2 -> StoreItemPurchaseLimitExceededError", async () => {
    mockTransactGetDefaultAndVariant({
      openAt: nowSec - 100,
      inventoryCount: 10,
      soldCount: 0,
      limitType: "per_product",
      limitQty: 2,
      memberLists: [],
    });
    mockGetItemForLimits({ quantitiesByLimitId: { [LIMIT_ID_PRODUCT]: "2" } });
    await expectRejectName(
      checkItemSellable({
        userId: "str@illinois.edu",
        productId,
        variantId,
        dynamoClient: new DynamoDBClient({}),
        redisClient: redis as any,
      }),
      "StoreItemPurchaseLimitExceededError",
    );
  });

  test("memberLists empty -> use nonmember price", async () => {
    mockTransactGetDefaultAndVariant({
      openAt: nowSec - 100,
      inventoryCount: 2,
      soldCount: 0,
      memberLists: [],
    });
    mockGetItemForLimits({ quantitiesByLimitId: {} });
    const priceId = await checkItemSellable({
      userId: "empty@illinois.edu",
      productId,
      variantId,
      dynamoClient: new DynamoDBClient({}),
      redisClient: redis as any,
    });
    expect(priceId).toBe(NONMEMBER_PRICE_ID);
  });

  test("membership via Redis string 'true' -> member price", async () => {
    mockTransactGetDefaultAndVariant({
      openAt: nowSec - 100,
      inventoryCount: 9,
      soldCount: 1,
      memberLists: ["extclub"],
    });
    await redis.set(
      `membership:upper:extclub`,
      JSON.stringify({ isMember: "true" }),
    );
    const priceId = await checkItemSellable({
      userId: "UPPER@illinois.edu",
      productId,
      variantId,
      dynamoClient: new DynamoDBClient({}),
      redisClient: redis as any,
    });
    expect(priceId).toBe(MEMBER_PRICE_ID);
  });

  test("corrupted Redis JSON -> fallback to source(false) -> nonmember price", async () => {
    mockTransactGetDefaultAndVariant({
      openAt: nowSec - 100,
      inventoryCount: 9,
      soldCount: 1,
      memberLists: ["acmpaid"],
    });
    await redis.set(`membership:oops:acmpaid`, "{not-json");
    const priceId = await checkItemSellable({
      userId: "oops@illinois.edu",
      productId,
      variantId,
      dynamoClient: new DynamoDBClient({}),
      redisClient: redis as any,
    });
    expect(checkPaidMembershipFromTable).toHaveBeenCalled();
    expect(priceId).toBe(NONMEMBER_PRICE_ID);
  });

  test("member price missing -> InternalServerError", async () => {
    (checkPaidMembershipFromTable as any).mockResolvedValueOnce(true);
    mockTransactGetDefaultAndVariant({
      openAt: nowSec - 10,
      inventoryCount: 10,
      soldCount: 0,
      memberLists: ["acmpaid"],
      memberPriceId: "",
      nonmemberPriceId: NONMEMBER_PRICE_ID,
    });
    mockGetItemForLimits({ quantitiesByLimitId: {} });
    await expectRejectName(
      checkItemSellable({
        userId: "m@illinois.edu",
        productId,
        variantId,
        dynamoClient: new DynamoDBClient({}),
        redisClient: redis as any,
      }),
      "InternalServerError",
    );
  });

  test("nonmember price missing & not a member -> InternalServerError", async () => {
    (checkPaidMembershipFromTable as any).mockResolvedValue(false);
    (checkExternalMembership as any).mockResolvedValue(false);
    mockTransactGetDefaultAndVariant({
      openAt: nowSec - 10,
      inventoryCount: 10,
      soldCount: 0,
      memberLists: ["ext"],
      memberPriceId: MEMBER_PRICE_ID,
      nonmemberPriceId: "",
    });
    mockGetItemForLimits({ quantitiesByLimitId: {} });
    await expectRejectName(
      checkItemSellable({
        userId: "n@illinois.edu",
        productId,
        variantId,
        dynamoClient: new DynamoDBClient({}),
        redisClient: redis as any,
      }),
      "InternalServerError",
    );
  });
});

describe("createCheckoutSessionAndPersistCart (cart only; Stripe stubbed)", () => {
  beforeEach(async () => {
    ddbMock.reset();
    await redis.flushdb();
    vi.clearAllMocks();
  });

  test("empty lines -> ValidationError", async () => {
    await expectRejectName(
      createCheckoutSessionAndPersistCart({
        userId: "u@illinois.edu",
        username: "u@illinois.edu",
        stripeApiKey: "sk_test",
        dynamoClient: new DynamoDBClient({}),
        redisClient: redis as any,
        lines: [],
      }),
      "ValidationError",
    );
  });

  test("missing productId/variantId -> ValidationError", async () => {
    await expectRejectName(
      createCheckoutSessionAndPersistCart({
        userId: "u@illinois.edu",
        username: "u@illinois.edu",
        stripeApiKey: "sk_test",
        dynamoClient: new DynamoDBClient({}),
        redisClient: redis as any,
        lines: [{ productId: "", variantId: "v1", quantity: 1 } as any],
      }),
      "ValidationError",
    );

    await expectRejectName(
      createCheckoutSessionAndPersistCart({
        userId: "u@illinois.edu",
        username: "u@illinois.edu",
        stripeApiKey: "sk_test",
        dynamoClient: new DynamoDBClient({}),
        redisClient: redis as any,
        lines: [{ productId: "p1", variantId: "", quantity: 1 } as any],
      }),
      "ValidationError",
    );
  });

  test("quantity non-positive / non-integer -> ValidationError", async () => {
    await expectRejectName(
      createCheckoutSessionAndPersistCart({
        userId: "u@illinois.edu",
        username: "u@illinois.edu",
        stripeApiKey: "sk_test",
        dynamoClient: new DynamoDBClient({}),
        redisClient: redis as any,
        lines: [{ productId: "p1", variantId: "v1", quantity: 0 }],
      }),
      "ValidationError",
    );

    await expectRejectName(
      createCheckoutSessionAndPersistCart({
        userId: "u@illinois.edu",
        username: "u@illinois.edu",
        stripeApiKey: "sk_test",
        dynamoClient: new DynamoDBClient({}),
        redisClient: redis as any,
        lines: [{ productId: "p1", variantId: "v1", quantity: 1.5 } as any],
      }),
      "ValidationError",
    );
  });

  test("total quantity > 25 -> ValidationError", async () => {
    const lines = Array.from({ length: 13 }).map(() => ({
      productId: "p1",
      variantId: "v1",
      quantity: 2,
    }));
    ddbMock.on(TransactGetItemsCommand).resolves({
      Responses: [
        { Item: marshall({ productId: "p1", variantId: "DEFAULT" }) },
        {
          Item: marshall({
            productId: "p1",
            variantId: "v1",
            inventoryCount: 999,
            soldCount: 0,
            memberPriceId: "pm",
            nonmemberPriceId: "pn",
          }),
        },
      ],
    });
    ddbMock.on(GetItemCommand).resolves({});
    await expectRejectName(
      createCheckoutSessionAndPersistCart({
        userId: "u@illinois.edu",
        username: "u@illinois.edu",
        stripeApiKey: "sk_test",
        dynamoClient: new DynamoDBClient({}),
        redisClient: redis as any,
        lines,
      }),
      "ValidationError",
    );
  });

  test("aggregation -> two merged SKUs produce 4 tx items", async () => {
    const makeTX = (v: string) => [
      { Item: marshall({ productId: "p1", variantId: "DEFAULT" }) },
      {
        Item: marshall({
          productId: "p1",
          variantId: v,
          inventoryCount: 100,
          soldCount: 0,
          memberPriceId: "pm",
          nonmemberPriceId: "pn",
        }),
      },
    ];

    ddbMock.on(TransactGetItemsCommand).callsFake((cmd: any) => {
      const varKey = unmarshall(cmd.TransactItems[1].Get.Key);
      if (varKey.variantId === "v1")
        return Promise.resolve({ Responses: makeTX("v1") });
      if (varKey.variantId === "v2")
        return Promise.resolve({ Responses: makeTX("v2") });
      return Promise.reject(new Error("Unexpected variantId"));
    });

    ddbMock.on(GetItemCommand).resolves({});
    ddbMock.on(TransactWriteItemsCommand).resolves({});

    const url = await createCheckoutSessionAndPersistCart({
      userId: "u@illinois.edu",
      username: "u@illinois.edu",
      stripeApiKey: "sk_test",
      dynamoClient: new DynamoDBClient({}),
      redisClient: redis as any,
      lines: [
        { productId: "p1", variantId: "v1", quantity: 2 },
        { productId: "p1", variantId: "v1", quantity: 3 },
        { productId: "p1", variantId: "v2", quantity: 1 },
      ],
    });

    expect(typeof url).toBe("string");
    const txCalls = ddbMock.commandCalls(TransactWriteItemsCommand);
    expect(txCalls.length).toBe(1);
    const txInput = txCalls[0].args[0].input as any;
    expect(txInput.TransactItems).toHaveLength(4);

    const condChecks = txInput.TransactItems.filter(
      (t: any) => "ConditionCheck" in t,
    );
    const getQ = (c: any) =>
      Number(c.ConditionCheck.ExpressionAttributeValues[":q"].N);
    const hasQ5 = condChecks.some((c: any) => getQ(c) === 5);
    const hasQ1 = condChecks.some((c: any) => getQ(c) === 1);
    expect(hasQ5 && hasQ1).toBe(true);
  });

  test("TransactWrite fails -> bubble error", async () => {
    ddbMock.on(TransactGetItemsCommand).resolves({
      Responses: [
        { Item: marshall({ productId: "p1", variantId: "DEFAULT" }) },
        {
          Item: marshall({
            productId: "p1",
            variantId: "v1",
            inventoryCount: 3,
            soldCount: 0,
            memberPriceId: "pm",
            nonmemberPriceId: "pn",
          }),
        },
      ],
    });
    ddbMock.on(GetItemCommand).resolves({});
    ddbMock
      .on(TransactWriteItemsCommand)
      .rejects(new Error("capacity exceeded"));

    await expect(
      createCheckoutSessionAndPersistCart({
        userId: "u@illinois.edu",
        username: "u@illinois.edu",
        stripeApiKey: "sk_test",
        dynamoClient: new DynamoDBClient({}),
        redisClient: redis as any,
        lines: [{ productId: "p1", variantId: "v1", quantity: 1 }],
      }),
    ).rejects.toThrow("capacity exceeded");
  });

  test("ConditionCheck contains (inventoryCount - soldCount) >= :q", async () => {
    ddbMock.on(TransactGetItemsCommand).resolves({
      Responses: [
        { Item: marshall({ productId: "p1", variantId: "DEFAULT" }) },
        {
          Item: marshall({
            productId: "p1",
            variantId: "v1",
            inventoryCount: 4,
            soldCount: 1,
            memberPriceId: "pm",
            nonmemberPriceId: "pn",
          }),
        },
      ],
    });
    ddbMock.on(GetItemCommand).resolves({});
    ddbMock.on(TransactWriteItemsCommand).resolves({});

    await createCheckoutSessionAndPersistCart({
      userId: "u@illinois.edu",
      username: "u@illinois.edu",
      stripeApiKey: "sk_test",
      dynamoClient: new DynamoDBClient({}),
      redisClient: redis as any,
      lines: [{ productId: "p1", variantId: "v1", quantity: 3 }],
    });

    const txCalls = ddbMock.commandCalls(TransactWriteItemsCommand);
    const txInput = txCalls[0].args[0].input as any;
    const cond = txInput.TransactItems.find(
      (t: any) => !!t.ConditionCheck,
    )?.ConditionCheck;
    expect(cond).toBeTruthy();
    expect(cond.TableName).toBe(genericConfig.StoreInventoryTableName);
    expect(cond.ConditionExpression).toContain(
      "(inventoryCount - soldCount) >= :q",
    );
  });
});
