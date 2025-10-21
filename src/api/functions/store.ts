// TODO: (store) Create a function to check if a given product and variant are sellable to a given user
// If it is sellable, return the price ID to create a stripe checkout session for
import {
  DynamoDBClient,
  TransactGetItemsCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { genericConfig, environmentConfig } from "common/config.js";
import { InternalServerError, ValidationError } from "common/errors/index.js";
import { type Redis } from "api/types.js";
import { createCheckoutSession as stripeCreateCheckoutSession } from "api/functions/stripe.js";
import {
  checkExternalMembership,
  checkPaidMembershipFromTable,
} from "api/functions/membership.js";

// If not, return null.
export type CheckItemSellableInputs = {
  userId: string; // This is generally their Illinois email
  productId: string;
  variantId: string;
  dynamoClient: DynamoDBClient;
  redisClient: Redis;
};

export type CheckItemSellableOutputs = null | string;

// netid parse tool
const toNetId = (userEmail: string) =>
  userEmail.includes("@")
    ? userEmail.split("@")[0].toLowerCase()
    : userEmail.toLowerCase();

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
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as { isMember?: boolean };
      if (typeof parsed?.isMember === "boolean") {
        return parsed.isMember;
      }
    }
  } catch {
    // cache miss
  }

  // try find in DB
  if (listId === "acmpaid") {
    return await checkPaidMembershipFromTable(netId, dynamoClient);
  }
  return await checkExternalMembership(netId, listId, dynamoClient);
}

async function getDefaultAndVariant(
  dynamoClient: DynamoDBClient,
  productId: string,
  variantId: string,
): Promise<{ def: any | null; varr: any | null }> {
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
            Key: marshall({ productId, variantId }),
          },
        },
      ],
    }),
  );
  const [d, v] = tx.Responses ?? [];
  return {
    def: d?.Item ? unmarshall(d.Item) : null,
    varr: v?.Item ? unmarshall(v.Item) : null,
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
  const row = unmarshall(res.Item);
  return Number(row?.quantity ?? 0);
}

// In a transaction:
// First, check if there is stock.
// If there is stock, check that the user is still under their limit.
// If there is, check if they are a paid member.
// If paid member return member_price_id for the variant request, if not return the nonmember_price_id
export async function checkItemSellable({
  userId,
  productId,
  variantId,
  dynamoClient,
  redisClient,
}: CheckItemSellableInputs): Promise<CheckItemSellableOutputs> {
  // read
  const { def, varr } = await getDefaultAndVariant(
    dynamoClient,
    productId,
    variantId,
  );
  if (!varr || !def) {
    return null;
  }

  // sell time
  const nowSec = Math.floor(Date.now() / 1000);
  const openAt = typeof def.openAt === "number" ? def.openAt : undefined;
  if (openAt && nowSec < openAt) {
    return null;
  }

  // inventory
  const inventoryCount = Number(varr.inventoryCount ?? 0);
  const soldCount = Number(varr.soldCount ?? 0);
  if (inventoryCount - soldCount <= 0) {
    return null;
  }

  // limit
  const limitCfg = varr.limitConfiguration as
    | { type: "per_variant" | "per_product"; quantity: number }
    | undefined;

  if (limitCfg && limitCfg.quantity > 0) {
    const limitId =
      limitCfg.type === "per_product" ? productId : `${productId}#${variantId}`;
    const used = await getUserLimitUsage(dynamoClient, userId, limitId);
    if (used >= limitCfg.quantity) {
      return null;
    }
  }

  const memberLists: string[] = Array.isArray(varr.memberLists)
    ? [...varr.memberLists]
    : [];
  let isMember = false;
  if (memberLists.length > 0) {
    // any membership
    for (const listId of memberLists) {
      if (
        await isMemberOfList({
          listId,
          userEmail: userId,
          redisClient,
          dynamoClient,
        })
      ) {
        isMember = true;
        break;
      }
    }
  }

  const priceId: string | undefined = isMember
    ? varr.memberPriceId
    : varr.nonmemberPriceId;
  return priceId ?? null;
}

export type CreateCheckoutSessionInputs = {
  priceId: string;
  username: string;
  stripeApiKey: string;
  successUrl?: string;
  returnUrl?: string;
  allowPromotionCodes?: boolean;
};

export type CreateCheckoutSessionOutputs = string;

// simple wapper for checkout session
// TODO: handle mutliple quantity support, and (SKU)
export async function createCheckoutSession({
  priceId,
  username,
  stripeApiKey,
  successUrl,
  returnUrl,
  allowPromotionCodes = true,
}: CreateCheckoutSessionInputs): Promise<CreateCheckoutSessionOutputs> {
  if (!priceId) {
    throw new ValidationError({ message: "Missing priceId." });
  }
  if (!stripeApiKey) {
    throw new InternalServerError({ message: "Missing stripeApiKey." });
  }

  const env = (process.env.RunEnvironment === "prod" ? "prod" : "dev") as
    | "dev"
    | "prod";
  const userFacing = environmentConfig[env].UserFacingUrl;

  const url = await stripeCreateCheckoutSession({
    successUrl: successUrl ?? `${userFacing}/merch-store/checkout/success`,
    returnUrl: returnUrl ?? `${userFacing}/merch-store/checkout/cancel`,
    stripeApiKey,
    customerEmail: username, // user as customer_email
    items: [{ price: priceId, quantity: 1 }],
    initiator: "acm-store",
    allowPromotionCodes,
  });

  return url;
}
