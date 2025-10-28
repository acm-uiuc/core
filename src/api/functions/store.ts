// TODO: (store) Create a function to check if a given product and variant are sellable to a given user
// If it is sellable, return the price ID to create a stripe checkout session for
import {
  DynamoDBClient,
  TransactGetItemsCommand,
  GetItemCommand,
  TransactWriteItemsCommand,
  type TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { genericConfig, environmentConfig } from "common/config.js";
import { type Redis } from "api/types.js";
import { createCheckoutSession as stripeCreateCheckoutSession } from "api/functions/stripe.js";
import {
  checkExternalMembership,
  checkPaidMembershipFromTable,
} from "api/functions/membership.js";
import {
  StoreItemNotFoundError,
  StoreItemOutOfStockError,
  StoreItemNotSellTimeError,
  StoreItemPurchaseLimitExceededError,
  InternalServerError,
  ValidationError,
  DatabaseFetchError,
} from "common/errors/index.js";
// cache helpers (Dynamo-backed cache table)
import { getItemFromCache, insertItemIntoCache } from "api/functions/cache.js";
import { v4 as uuidv4 } from "uuid";

//  Types

type LimitConfiguration =
  | { type: "per_variant"; quantity: number }
  | { type: "per_product"; quantity: number };

type StoreInventoryItem = {
  productId: string;
  variantId: string;
  openAt?: number; // seconds
  inventoryCount?: number;
  soldCount?: number;
  memberLists?: string[];
  limitConfiguration?: LimitConfiguration;
  memberPriceId?: string;
  nonmemberPriceId?: string;
  // Extend with more fields as your schema grows
};

export type CheckItemSellableInputs = {
  userId: string; // This is generally their Illinois email
  productId: string;
  variantId: string;
  dynamoClient: DynamoDBClient;
  redisClient: Redis;
};

export type CheckItemSellableOutputs = string; // return priceId

export type CreateCheckoutSessionInputs = {
  priceId: string;
  username: string;
  stripeApiKey: string;
  successUrl?: string;
  returnUrl?: string;
  allowPromotionCodes?: boolean;
  metadata?: Record<string, string>;
  customFields?: import("stripe").Stripe.Checkout.SessionCreateParams.CustomField[];
};

export type CreateCheckoutSessionOutputs = string;

// Cart checkout (new feature)
type CartLineInput = { productId: string; variantId: string; quantity: number };

//  utils

// netid parse tool
const toNetId = (userEmail: string) =>
  userEmail.includes("@")
    ? userEmail.split("@")[0].toLowerCase()
    : userEmail.toLowerCase();

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

// membership caching utils
const MEMBERSHIP_CACHE_TTL_SEC = 600; // 10 minutes
const CART_MAX_ITEMS = 25;

function deserializeIsMember(s: string | null | undefined): boolean | null {
  if (!s) {
    return null;
  }
  try {
    const o = JSON.parse(s) as { isMember?: boolean | number | string };
    if (typeof o.isMember === "boolean") {
      return o.isMember;
    }
    if (typeof o.isMember === "number") {
      return o.isMember === 1;
    }
    if (typeof o.isMember === "string") {
      return o.isMember === "true" || o.isMember === "1";
    }
  } catch {
    // ignore JSON parse errors
  }
  return null;
}

/**
 * Support both node-redis v4 ({ EX }) and legacy/ioredis ("EX", ttl)
 * without using any / ts-ignore.
 */
async function setRedisJsonWithTTL(
  redis: Redis,
  key: string,
  value: unknown,
  ttlSec: number,
) {
  const payload = JSON.stringify(value);

  // Branch 1: node-redis v4 style
  try {
    const setFn1 = (
      redis as unknown as {
        set: (k: string, v: string, opts: { EX: number }) => Promise<unknown>;
      }
    ).set;
    await setFn1(key, payload, { EX: ttlSec });
    return;
  } catch {
    // fall through
  }

  // Branch 2: ioredis style
  try {
    const setFn2 = (
      redis as unknown as {
        set: (
          k: string,
          v: string,
          mode: "EX",
          ttl: number,
        ) => Promise<unknown>;
      }
    ).set;
    await setFn2(key, payload, "EX", ttlSec);
  } catch {
    // swallow cache errors
  }
}

async function writeBackCaches(
  dynamoClient: DynamoDBClient,
  redisClient: Redis,
  cacheKey: string,
  isMember: boolean,
  ttlSec: number = MEMBERSHIP_CACHE_TTL_SEC,
) {
  // Redis
  await setRedisJsonWithTTL(redisClient, cacheKey, { isMember }, ttlSec);

  // Dynamo cache table
  try {
    const expireAt = new Date(Date.now() + ttlSec * 1000);
    await insertItemIntoCache(
      dynamoClient,
      cacheKey,
      { isMember: isMember ? 1 : 0 },
      expireAt,
    );
  } catch {
    // ignore cache write errors
  }
}

async function isMemberOfList({
  listId,
  userEmail,
  redisClient,
  dynamoClient,
}: {
  listId: string;
  userEmail: string;
  redisClient: Redis;
  dynamoClient: DynamoDBClient;
}): Promise<boolean> {
  const netId = toNetId(userEmail);
  const cacheKey = `membership:${netId}:${listId}`;

  // 1. Redis first
  try {
    const cached = await redisClient.get(cacheKey);
    const fromRedis = deserializeIsMember(cached);
    if (fromRedis !== null) {
      return fromRedis;
    }
  } catch {
    // ignore redis errors
  }

  // 2. Dynamo cache table
  try {
    const ddbCached = (await getItemFromCache(dynamoClient, cacheKey)) as {
      isMember?: number | string | boolean;
    } | null;

    if (ddbCached && typeof ddbCached.isMember !== "undefined") {
      const isMember =
        typeof ddbCached.isMember === "number"
          ? ddbCached.isMember === 1
          : ddbCached.isMember === "1" ||
            ddbCached.isMember === "true" ||
            ddbCached.isMember === true;

      await setRedisJsonWithTTL(
        redisClient,
        cacheKey,
        { isMember },
        MEMBERSHIP_CACHE_TTL_SEC,
      );
      return isMember;
    }
  } catch {
    // ignore cache-table errors
  }

  // 3. Fallback to source of truth
  let isMember = false;
  try {
    if (listId === "acmpaid") {
      isMember = await checkPaidMembershipFromTable(netId, dynamoClient);
    } else {
      isMember = await checkExternalMembership(netId, listId, dynamoClient);
    }
  } catch {
    throw new DatabaseFetchError({
      message: `Failed to fetch membership status from source for list '${listId}'.`,
    });
  }

  // 4. Write-through to both caches
  await writeBackCaches(
    dynamoClient,
    redisClient,
    cacheKey,
    isMember,
    MEMBERSHIP_CACHE_TTL_SEC,
  );

  return isMember;
}

//  DB helpers

async function getDefaultAndVariant(
  dynamoClient: DynamoDBClient,
  productId: string,
  variantId: string,
): Promise<{
  def: StoreInventoryItem | null;
  varr: StoreInventoryItem | null;
}> {
  const tx = await dynamoClient.send(
    new TransactGetItemsCommand({
      TransactItems: [
        {
          Get: {
            TableName: genericConfig.StoreInventoryTableName,
            Key: marshall({ productId, variantId: "DEFAULT" }),
          },
        },
        {
          Get: {
            TableName: genericConfig.StoreInventoryTableName,
            Key: marshall({ productId, variantId }), // same as above
          },
        },
      ],
    }),
  );
  const [d, v] = tx.Responses ?? [];
  return {
    def: d?.Item ? (unmarshall(d.Item) as StoreInventoryItem) : null,
    varr: v?.Item ? (unmarshall(v.Item) as StoreInventoryItem) : null,
  };
}

async function getUserLimitUsage(
  dynamoClient: DynamoDBClient,
  userEmail: string,
  limitId: string,
): Promise<number> {
  const res = await dynamoClient.send(
    new GetItemCommand({
      TableName: genericConfig.StoreLimitsTableName,
      Key: marshall({ userId: userEmail.toLowerCase(), limitId }),
    }),
  );
  if (!res.Item) {
    return 0;
  }
  const row = unmarshall(res.Item) as { quantity?: number | string };
  const q =
    typeof row.quantity === "string"
      ? Number(row.quantity)
      : typeof row.quantity === "number"
        ? row.quantity
        : 0;
  return Number.isFinite(q) ? q : 0;
}

//  Core: sellable + price selection

export async function checkItemSellable({
  userId,
  productId,
  variantId,
  dynamoClient,
  redisClient,
}: CheckItemSellableInputs): Promise<CheckItemSellableOutputs> {
  // Validation
  if (!isNonEmptyString(userId)) {
    throw new ValidationError({ message: "Missing or invalid userId." });
  }
  if (!isNonEmptyString(productId)) {
    throw new ValidationError({ message: "Missing or invalid productId." });
  }
  if (!isNonEmptyString(variantId)) {
    throw new ValidationError({ message: "Missing or invalid variantId." });
  }

  // Get Config
  const { def, varr } = await getDefaultAndVariant(
    dynamoClient,
    productId,
    variantId,
  );

  if (!def) {
    throw new StoreItemNotFoundError({
      message: "Product not found.",
    });
  }
  if (!varr) {
    throw new StoreItemNotFoundError({
      message: "Variant not found.",
    });
  }

  // Sell time
  const nowSec = Math.floor(Date.now() / 1000);
  const openAt =
    typeof def.openAt === "number" && Number.isFinite(def.openAt)
      ? def.openAt
      : undefined;
  if (openAt && nowSec < openAt) {
    throw new StoreItemNotSellTimeError({
      message: "Item is not sellable yet.",
    });
  }

  // inventory
  const inventoryCount =
    typeof varr.inventoryCount === "number" &&
    Number.isFinite(varr.inventoryCount)
      ? varr.inventoryCount
      : 0;
  const soldCount =
    typeof varr.soldCount === "number" && Number.isFinite(varr.soldCount)
      ? varr.soldCount
      : 0;
  if (inventoryCount - soldCount <= 0) {
    throw new StoreItemOutOfStockError({ message: "Item is out of stock." });
  }

  // limit
  const limitCfg = varr.limitConfiguration;
  if (limitCfg && Number(limitCfg.quantity) > 0) {
    const limitId =
      limitCfg.type === "per_product" ? productId : `${productId}#${variantId}`;
    const used = await getUserLimitUsage(dynamoClient, userId, limitId);
    if (used >= limitCfg.quantity) {
      throw new StoreItemPurchaseLimitExceededError({
        message: "Purchase limit exceeded for this item.",
      });
    }
  }

  // membership
  const memberLists: string[] = Array.isArray(varr.memberLists)
    ? [...varr.memberLists]
    : [];
  let isMember = false;
  if (memberLists.length > 0) {
    for (const listId of memberLists) {
      const ok = await isMemberOfList({
        listId,
        userEmail: userId,
        redisClient,
        dynamoClient,
      });
      if (ok) {
        isMember = true;
        break;
      }
    }
  }

  // price choice
  const priceId = isMember ? varr.memberPriceId : varr.nonmemberPriceId;

  if (!isNonEmptyString(priceId)) {
    throw new InternalServerError({
      message: "No valid price configured for this product.",
      internalLog: `[store] Missing priceId for product=${productId}, variant=${variantId}, isMember=${isMember}`,
    });
  }

  return priceId;
}

//  Simple (single-line) checkout wrapper

export async function createCheckoutSession({
  priceId,
  username,
  stripeApiKey,
  successUrl,
  returnUrl,
  allowPromotionCodes = true,
  metadata,
  customFields,
}: CreateCheckoutSessionInputs): Promise<CreateCheckoutSessionOutputs> {
  if (!isNonEmptyString(priceId)) {
    throw new ValidationError({ message: "Missing priceId." });
  }
  if (!isNonEmptyString(stripeApiKey)) {
    throw new InternalServerError({ message: "Missing stripeApiKey." });
  }
  if (!isNonEmptyString(username)) {
    throw new ValidationError({
      message: "Missing username (customer email).",
    });
  }

  const env: "dev" | "prod" =
    process.env.RunEnvironment === "prod" ? "prod" : "dev";
  const userFacing = environmentConfig[env].UserFacingUrl;

  const url = await stripeCreateCheckoutSession({
    successUrl: successUrl ?? `${userFacing}/merch-store/checkout/success`,
    returnUrl: returnUrl ?? `${userFacing}/merch-store/checkout/cancel`,
    stripeApiKey,
    customerEmail: username, // user as customer_email
    items: [{ price: priceId, quantity: 1 }],
    initiator: "acm-store",
    allowPromotionCodes,
    metadata,
    customFields,
  });

  return url;
}

//  High-level checkout with cart & transact write

function assertPositiveInt(n: unknown, field: string) {
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
    throw new ValidationError({
      message: `Invalid ${field}: must be a positive integer.`,
    });
  }
}

function aggregateLines(lines: CartLineInput[]) {
  const map = new Map<string, CartLineInput>();
  for (const l of lines) {
    const key = `${l.productId}#${l.variantId}`;
    const prev = map.get(key);
    if (prev) {
      prev.quantity += l.quantity;
    } else {
      map.set(key, { ...l });
    }
  }
  return [...map.values()];
}

function buildSkusMetadata(lines: CartLineInput[]): string {
  return lines
    .map((l) => `${l.productId}#${l.variantId}:${l.quantity}`)
    .join(",");
}

// if paid but validate failed, refund
// in the future switch to Pre-authorization
export async function createCheckoutSessionAndPersistCart({
  userId,
  username,
  stripeApiKey,
  successUrl,
  returnUrl,
  allowPromotionCodes = true,
  customFields,
  metadata,
  dynamoClient,
  redisClient,
  lines,
}: {
  userId: string;
  username: string; // stripe customer_email
  stripeApiKey: string;
  successUrl?: string;
  returnUrl?: string;
  allowPromotionCodes?: boolean;
  customFields?: import("stripe").Stripe.Checkout.SessionCreateParams.CustomField[];
  metadata?: Record<string, string>;
  dynamoClient: DynamoDBClient;
  redisClient: Redis;
  lines: CartLineInput[];
}): Promise<string> {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new ValidationError({
      message: "Cart lines must be a non-empty array.",
    });
  }
  for (const l of lines) {
    if (!l.productId || !l.variantId) {
      throw new ValidationError({
        message: "Each line must include productId and variantId.",
      });
    }
    assertPositiveInt(l.quantity, "quantity");
  }
  const aggregated = aggregateLines(lines);

  const totalQty = aggregated.reduce((s, l) => s + l.quantity, 0);
  if (totalQty > CART_MAX_ITEMS) {
    throw new ValidationError({
      message: `Cart has ${totalQty} items; the maximum allowed per checkout is ${CART_MAX_ITEMS}.`,
    });
  }

  // 1) Sellability/purchase limit static validation + price selection
  const priceLines = await Promise.all(
    aggregated.map(async (l) => {
      const priceId = await checkItemSellable({
        userId,
        productId: l.productId,
        variantId: l.variantId,
        dynamoClient,
        redisClient,
      });
      return { ...l, priceId };
    }),
  );

  // 2) Generate order_id / line_item_id; transactionally write PENDING rows with inventory upper bound ConditionCheck (no inventory modification)
  const orderId = uuidv4();
  const createdAt = new Date().toISOString();

  const txItems: TransactWriteItem[] = [];

  for (const l of priceLines) {
    const lineItemId = uuidv4();

    // ConditionCheck: inventory_count - sold_count >= :q
    txItems.push({
      ConditionCheck: {
        TableName: genericConfig.StoreInventoryTableName,
        Key: marshall({ productId: l.productId, variantId: l.variantId }),
        ConditionExpression: "(inventoryCount - soldCount) >= :q",
        ExpressionAttributeValues: marshall({ ":q": l.quantity }),
      },
    });

    // Put: write to table2 as PENDING row
    txItems.push({
      Put: {
        TableName: genericConfig.StoreOrdersTableName, // e.g. infra-core-api-store-carts-orders
        Item: marshall({
          order_id: orderId,
          line_item_id: lineItemId,
          item_id: l.productId,
          variant_id: l.variantId,
          quantity: l.quantity,
          status: "PENDING",
          created_at: createdAt,
          stripe_payment_id: null,
          refund_id: null,
          price_id_snapshot: l.priceId,
        }),
        ConditionExpression:
          "attribute_not_exists(order_id) AND attribute_not_exists(line_item_id)",
      },
    });
  }

  await dynamoClient.send(
    new TransactWriteItemsCommand({ TransactItems: txItems }),
  );

  // 3) Create Stripe Checkout (maintain reuse of stripe.js; capture_method not required)
  const cartSkus = buildSkusMetadata(aggregated);
  const url = await stripeCreateCheckoutSession({
    successUrl,
    returnUrl,
    stripeApiKey,
    customerEmail: username,
    items: priceLines.map((l) => ({
      price: l.priceId as string,
      quantity: l.quantity,
    })),
    initiator: "acm-store",
    allowPromotionCodes,
    customFields,
    metadata: {
      ...(metadata || {}),
      order_id: orderId, // for webhook reconciliation
      cart_skus: cartSkus, // e.g. "sweatshirt_2025#L:2,sweatshirt_2025#S:1"
      user_id: userId,
    },
  });

  if (!url) {
    throw new InternalServerError({
      message: "Failed to create Stripe checkout session.",
    });
  }
  return url;
}
