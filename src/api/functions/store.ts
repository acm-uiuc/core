// TODO: (store) Create a function to check if a given product and variant are sellable to a given user
// If it is sellable, return the price ID to create a stripe checkout session for

import {
  type DynamoDBClient,
  GetItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { type Redis } from "api/types.js";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { genericConfig } from "common/config.js";
import {
  checkExternalMembership,
  checkPaidMembershipFromTable,
} from "./membership.js";
import { ItemNotSellableError } from "common/errors/index.js";

// If not, return null.
export type CheckItemSellableInputs = {
  userId: string; // This is generally their Illinois email
  productId: string;
  variantId: string;
  dynamoClient: DynamoDBClient;
  redisClient: Redis;
};

export type CheckItemSellableOutputs = null | string;

export async function checkItemSellable({
  userId,
  productId,
  variantId,
  dynamoClient,
  redisClient,
}: CheckItemSellableInputs): Promise<CheckItemSellableOutputs> {
  // 1. Fetch item metadata from the merch metadata table
  const getCmd = new GetItemCommand({
    TableName: genericConfig.MerchStoreMetadataTableName,
    Key: marshall({ item_id: productId }),
  });
  const getResp = await dynamoClient.send(getCmd);
  if (!getResp.Item) {
    throw new ItemNotSellableError({
      message: `Product ${productId} does not exist.`,
    });
  }
  const item = unmarshall(getResp.Item) as Record<string, any>;

  // 2. Ensure sales are active for this item
  // item_sales_active_utc uses -1 for inactive, otherwise seconds since epoch
  const salesActiveRaw = item.item_sales_active_utc;
  if (typeof salesActiveRaw !== "undefined") {
    const salesActiveNum = Number(salesActiveRaw);
    if (salesActiveNum === -1) {
      throw new ItemNotSellableError({
        message: "This item is not currently available for purchase.",
      });
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!Number.isNaN(salesActiveNum) && salesActiveNum > nowSeconds) {
      const salesDate = new Date(salesActiveNum * 1000);
      throw new ItemNotSellableError({
        message: `Sales for this item begin on ${salesDate.toLocaleString()}.`,
      });
    }
  }

  // 3. Check variant stock (if variants/total_avail exist)
  // Variant ids in existing metadata are usually sizes and stored in `total_avail` map
  const totalAvail = item.total_avail || item.totalAvail || null;
  if (totalAvail) {
    const availForVariant = totalAvail[variantId];
    const availNum = availForVariant ? Number(availForVariant) : 0;
    if (!availForVariant || Number.isNaN(availNum) || availNum <= 0) {
      throw new ItemNotSellableError({
        message: `Variant ${variantId} is currently out of stock.`,
      });
    }
  }

  // 4. Check user's existing purchases for this item to enforce a per-user limit if defined on item
  // Try to detect common limit fields on the item (if absent, assume no limit)
  const possibleLimitKeys = [
    "max_per_person",
    "max_per",
    "per_person_limit",
    "purchase_limit",
    "item_limit",
    "limit",
  ];
  let perUserLimit: number | null = null;
  for (const k of possibleLimitKeys) {
    if (typeof item[k] !== "undefined") {
      const val = Number(item[k]);
      if (!Number.isNaN(val)) {
        perUserLimit = val;
        break;
      }
    }
  }

  if (perUserLimit !== null) {
    // Query all purchases for this item and count purchases by this user
    const queryCmd = new QueryCommand({
      TableName: genericConfig.MerchStorePurchasesTableName,
      IndexName: "ItemIdIndexAll",
      KeyConditionExpression: "item_id = :itemId",
      ExpressionAttributeValues: {
        ":itemId": { S: productId },
      },
    });
    const purchasesResp = await dynamoClient.send(queryCmd);
    let userPurchased = 0;
    if (purchasesResp.Items) {
      for (const it of purchasesResp.Items) {
        const p = unmarshall(it) as Record<string, any>;
        // purchaser may be stored as `email` or `purchaser_email`
        const purchaserEmail =
          p.email || p.purchaser_email || p.ticketholder_email || null;
        if (!purchaserEmail) {
          continue;
        }
        // Normalize email compare
        if (purchaserEmail.toLowerCase() === userId.toLowerCase()) {
          const qty = p.quantity ? Number(p.quantity) : 1;
          userPurchased += Number.isNaN(qty) ? 0 : qty;
        }
      }
    }
    if (userPurchased >= perUserLimit) {
      throw new ItemNotSellableError({
        message: `You have reached the maximum purchase limit (${perUserLimit}) for this item.`,
      });
    }
  }

  // 5. Determine whether the user is a paid member (try external membership check using netid)
  const netId = (userId || "").split("@")[0].toLowerCase();
  let isMember = false;
  try {
    // First, check paid membership stored in user-info table.
    isMember = await checkPaidMembershipFromTable(netId, dynamoClient);
  } catch (_e) {
    // If that fails, fall back to checking external membership lists (silent failure -> non-member)
    try {
      isMember = await checkExternalMembership(netId, "acmpaid", dynamoClient);
    } catch (_err) {
      isMember = false;
    }
  }

  // 6. Lookup price id (allow item-level or variant-level price ids)
  // Variant-level structure may be item.variants?.[variantId]?.member_price
  let memberPriceId: string | undefined;
  let nonmemberPriceId: string | undefined;

  // Variant-level overrides
  if (item.variants && item.variants[variantId]) {
    const variant = item.variants[variantId];
    memberPriceId =
      variant.member_price || variant.memberPrice || variant.member_price_id;
    nonmemberPriceId =
      variant.nonmember_price ||
      variant.nonMemberPrice ||
      variant.nonmember_price_id;
  }

  // Item-level fallback
  memberPriceId =
    memberPriceId ||
    item.member_price ||
    item.memberPrice ||
    item.member_price_id ||
    item.member_priceid ||
    item.member_priceId;
  nonmemberPriceId =
    nonmemberPriceId ||
    item.nonmember_price ||
    item.nonMemberPrice ||
    item.nonmember_price_id ||
    item.nonmember_priceid ||
    item.nonmember_priceId ||
    item.nonmember_price;

  const selected = isMember ? memberPriceId : nonmemberPriceId;
  if (!selected) {
    // If no price id found, not sellable
    throw new ItemNotSellableError({
      message: "Price information is not configured for this item.",
    });
  }

  return selected;
}

export type CreateCheckoutSessionInputs = {
  priceId: string;
  username: string;
  stripeApiKey: string;
};

export type CreateCheckoutSessionOutputs = string;

export async function createCheckoutSession({
  priceId,
}: CreateCheckoutSessionInputs): Promise<CreateCheckoutSessionOutputs> {
  // Check stripe modules createCheckoutSession function
  // initatior string should be "acm-store"
  return "";
}
