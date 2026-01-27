import {
  type AttributeValue,
  BatchGetItemCommand,
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  QueryCommandInput,
  ScanCommand,
  TransactWriteItemsCommand,
  TransactWriteItemsCommandInput,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { genericConfig } from "common/config.js";
import {
  InsufficientInventoryError,
  ItemNotAvailableError,
  LimitExceededError,
  OrderNotFoundError,
  DatabaseInsertError,
  ValidationError,
  InternalServerError,
} from "common/errors/index.js";
import { checkExternalMembership, checkPaidMembership } from "./membership.js";
import {
  createCheckoutSession,
  createCheckoutSessionWithCustomer,
  capturePaymentIntent,
  cancelPaymentIntent,
  shouldRetryStripeError,
} from "./stripe.js";
import { getUserIdentity } from "./identity.js";
import {
  logOnRetry,
  retryDynamoTransactionWithBackoff,
  retryWithBackoff,
} from "api/utils.js";
import { randomUUID } from "crypto";
import type { Redis, ValidLoggers } from "api/types.js";
import {
  type CreateCheckoutRequest,
  type LineItem,
  type Order,
  type ProductWithVariants,
  type Variant,
  type SellabilityResult,
  type LimitConfiguration,
  type CreateProductRequest,
  DEFAULT_VARIANT_ID,
  LimitType,
} from "common/types/store.js";
import Stripe from "stripe";
import { getNetIdFromEmail } from "common/utils.js";
import { buildAuditLogTransactPut } from "./auditLog.js";
import { Modules } from "common/modules.js";

// ============ Helper Functions ============

export async function checkUserMembership({
  userId,
  memberLists,
  dynamoClient,
  redisClient,
  logger,
}: {
  userId: string;
  memberLists: string[];
  dynamoClient: DynamoDBClient;
  redisClient: Redis;
  logger: ValidLoggers;
}): Promise<boolean> {
  const netId = getNetIdFromEmail(userId);

  // If no specific lists required, check if paid ACM member
  if (!memberLists || memberLists.length === 0) {
    return checkPaidMembership({ netId, dynamoClient, redisClient, logger });
  }

  const checks = memberLists.map((list) => {
    if (list === "acmpaid") {
      return checkPaidMembership({
        netId,
        dynamoClient,
        redisClient,
        logger,
      });
    }
    return checkExternalMembership(netId, list, dynamoClient);
  });

  // Execute all checks concurrently using allSettled
  const results = await Promise.allSettled(checks);
  for (const result of results) {
    if (result.status === "rejected") {
      logger.warn({ err: result.reason }, "Membership check failed");
    }
  }
  // Return true if any check succeeded and returned true
  return results.some(
    (result) => result.status === "fulfilled" && result.value === true,
  );
}

// ============ Product/Inventory Functions ============

export async function getProduct({
  productId,
  dynamoClient,
  includeInactive,
}: {
  productId: string;
  dynamoClient: DynamoDBClient;
  includeInactive: boolean | undefined;
}): Promise<ProductWithVariants> {
  // Query all items with this productId (includes DEFAULT variant for product-level data)
  const command = new QueryCommand({
    TableName: genericConfig.StoreInventoryTableName,
    KeyConditionExpression: "productId = :pid",
    ExpressionAttributeValues: marshall({ ":pid": productId }),
  });

  const response = await dynamoClient.send(command);
  if (!response.Items || response.Items.length === 0) {
    throw new ItemNotAvailableError({ message: "Product not found." });
  }

  const items = response.Items.map((item) => unmarshall(item));
  const defaultVariant = items.find(
    (item) => item.variantId === DEFAULT_VARIANT_ID,
  );
  const variants = items.filter(
    (item) => item.variantId !== DEFAULT_VARIANT_ID,
  );

  if (!defaultVariant) {
    throw new ItemNotAvailableError({
      message: "Product configuration not found.",
    });
  }

  // Filter inactive products unless requested
  if (!includeInactive) {
    const now = Math.floor(Date.now() / 1000);
    if (defaultVariant.openAt && now < defaultVariant.openAt) {
      throw new ItemNotAvailableError({ message: "Product not found." });
    }
    if (defaultVariant.closeAt && now > defaultVariant.closeAt) {
      throw new ItemNotAvailableError({ message: "Product not found." });
    }
  }

  const inventoryMode =
    (defaultVariant.inventoryMode as LimitType) ?? "PER_VARIANT";

  return {
    productId: defaultVariant.productId as string,
    name: defaultVariant.name as string,
    description: defaultVariant.description as string | undefined,
    imageUrl: defaultVariant.imageUrl as string | undefined,
    openAt: defaultVariant.openAt as number | undefined,
    closeAt: defaultVariant.closeAt as number | undefined,
    stripeProductId: defaultVariant.stripeProductId as string | undefined,
    limitConfiguration: defaultVariant.limitConfiguration as
      | LimitConfiguration
      | undefined,
    verifiedIdentityRequired:
      (defaultVariant.verifiedIdentityRequired as boolean) ?? true,
    inventoryMode,
    totalInventoryCount:
      inventoryMode === "PER_PRODUCT"
        ? (defaultVariant.totalInventoryCount as number | null | undefined)
        : undefined,
    totalSoldCount:
      inventoryMode === "PER_PRODUCT"
        ? (defaultVariant.totalSoldCount as number) || 0
        : undefined,
    variants: variants.map((v) => ({
      variantId: v.variantId as string,
      name: v.name as string,
      description: v.description as string | undefined,
      imageUrl: v.imageUrl as string | undefined,
      memberLists: (v.memberLists as string[]) ?? ["acmpaid"],
      memberPriceId: v.memberPriceId as string,
      nonmemberPriceId: v.nonmemberPriceId as string,
      inventoryCount:
        inventoryMode === "PER_VARIANT"
          ? (v.inventoryCount as number | null | undefined)
          : undefined,
      soldCount: (v.soldCount as number) || 0,
      exchangesAllowed: (v.exchangesAllowed as boolean) ?? true,
      limitConfiguration: v.limitConfiguration as
        | LimitConfiguration
        | undefined,
    })),
  };
}

export async function listProducts({
  dynamoClient,
  includeInactive,
}: {
  dynamoClient: DynamoDBClient;
  includeInactive?: boolean;
}): Promise<ProductWithVariants[]> {
  // Scan the inventory table
  const allItems: Record<string, unknown>[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const response = await dynamoClient.send(
      new ScanCommand({
        TableName: genericConfig.StoreInventoryTableName,
        ExclusiveStartKey: lastEvaluatedKey
          ? marshall(lastEvaluatedKey)
          : undefined,
      }),
    );

    if (response.Items) {
      allItems.push(...response.Items.map((i) => unmarshall(i)));
    }
    lastEvaluatedKey = response.LastEvaluatedKey
      ? unmarshall(response.LastEvaluatedKey)
      : undefined;
  } while (lastEvaluatedKey);

  if (!allItems || allItems.length === 0) {
    return [];
  }

  // Group by productId
  const productMap = new Map<
    string,
    {
      product?: Record<string, unknown>;
      variants: Record<string, unknown>[];
    }
  >();

  for (const item of allItems) {
    const pid = item.productId as string;
    if (!productMap.has(pid)) {
      productMap.set(pid, { variants: [] });
    }

    if (item.variantId === DEFAULT_VARIANT_ID) {
      productMap.get(pid)!.product = item;
    } else {
      productMap.get(pid)!.variants.push(item);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const products: ProductWithVariants[] = [];

  for (const [, data] of productMap) {
    if (!data.product) {
      continue;
    }

    const p = data.product;

    // Filter inactive products unless requested
    if (!includeInactive) {
      if (p.openAt && now < (p.openAt as number)) {
        continue;
      }
      if (p.closeAt && now > (p.closeAt as number)) {
        continue;
      }
    }

    const inventoryMode = (p.inventoryMode as LimitType) ?? "PER_VARIANT";

    products.push({
      productId: p.productId as string,
      name: p.name as string,
      description: p.description as string | undefined,
      imageUrl: p.imageUrl as string | undefined,
      openAt: p.openAt as number | undefined,
      closeAt: p.closeAt as number | undefined,
      stripeProductId: p.stripeProductId as string | undefined,
      verifiedIdentityRequired: (p.verifiedIdentityRequired as boolean) ?? true,
      limitConfiguration: p.limitConfiguration as
        | LimitConfiguration
        | undefined,
      inventoryMode,
      totalInventoryCount:
        inventoryMode === "PER_PRODUCT"
          ? (p.totalInventoryCount as number | null | undefined)
          : undefined,
      totalSoldCount:
        inventoryMode === "PER_PRODUCT"
          ? (p.totalSoldCount as number) || 0
          : undefined,
      variants: data.variants.map((v) => ({
        variantId: v.variantId as string,
        name: v.name as string,
        description: v.description as string | undefined,
        imageUrl: v.imageUrl as string | undefined,
        memberLists: (v.memberLists as string[]) ?? ["acmpaid"],
        memberPriceId: v.memberPriceId as string,
        nonmemberPriceId: v.nonmemberPriceId as string,
        inventoryCount:
          inventoryMode === "PER_VARIANT"
            ? (v.inventoryCount as number | null | undefined)
            : undefined,
        soldCount: (v.soldCount as number) || 0,
        exchangesAllowed: (v.exchangesAllowed as boolean) ?? true,
        limitConfiguration: v.limitConfiguration as
          | LimitConfiguration
          | undefined,
      })),
    });
  }

  return products;
}

export async function getVariant({
  productId,
  variantId,
  dynamoClient,
}: {
  productId: string;
  variantId: string;
  dynamoClient: DynamoDBClient;
}): Promise<Variant> {
  const command = new GetItemCommand({
    TableName: genericConfig.StoreInventoryTableName,
    Key: marshall({ productId, variantId }),
  });

  const response = await dynamoClient.send(command);
  if (!response.Item) {
    throw new ItemNotAvailableError({ message: "Variant not found." });
  }

  return unmarshall(response.Item) as Variant;
}

// ============ Sellability Check ============

export type CheckItemSellableInputs = {
  userId: string;
  productId: string;
  variantId: string;
  quantity: number;
  dynamoClient: DynamoDBClient;
  redisClient: Redis;
  logger: ValidLoggers;
  isVerifiedIdentity: boolean;
};

export async function checkItemSellable({
  userId,
  productId,
  variantId,
  quantity,
  dynamoClient,
  redisClient,
  logger,
  isVerifiedIdentity,
}: CheckItemSellableInputs): Promise<SellabilityResult | null> {
  // 1. Get product and variant data
  const [productData, variantData] = await Promise.all([
    dynamoClient.send(
      new GetItemCommand({
        TableName: genericConfig.StoreInventoryTableName,
        Key: marshall({ productId, variantId: DEFAULT_VARIANT_ID }),
      }),
    ),
    dynamoClient.send(
      new GetItemCommand({
        TableName: genericConfig.StoreInventoryTableName,
        Key: marshall({ productId, variantId }),
      }),
    ),
  ]);

  if (!productData.Item || !variantData.Item) {
    logger.info({ productId, variantId }, "Product or variant not found");
    return null;
  }

  const product = unmarshall(productData.Item);
  const variant = unmarshall(variantData.Item);

  if (product.verifiedIdentityRequired && !isVerifiedIdentity) {
    logger.info(
      { productId, userId },
      "Product requires verified identity for purchase.",
    );
    return null;
  }

  // 2. Check if product is open for sales
  const now = Math.floor(Date.now() / 1000);
  if (product.openAt && now < product.openAt) {
    logger.info({ productId }, "Product not yet open for sales");
    return null;
  }
  if (product.closeAt && now > product.closeAt) {
    logger.info({ productId }, "Product sales have closed");
    return null;
  }

  const inventoryMode = (product.inventoryMode as string) || "PER_VARIANT";
  if (inventoryMode === "PER_PRODUCT") {
    const totalInventory = product.totalInventoryCount as
      | number
      | null
      | undefined;
    if (totalInventory !== null && totalInventory !== undefined) {
      const totalSold = (product.totalSoldCount as number) || 0;
      const available = totalInventory - totalSold;

      if (available < quantity) {
        logger.info(
          { productId, available, requested: quantity },
          "Insufficient product-level inventory",
        );
        throw new InsufficientInventoryError({});
      }
    }
  } else if (
    variant.inventoryCount !== null &&
    variant.inventoryCount !== undefined
  ) {
    const available = variant.inventoryCount;

    if (available < quantity) {
      logger.info(
        { productId, variantId, available, requested: quantity },
        "Insufficient inventory",
      );
      throw new InsufficientInventoryError({});
    }
  }

  // 4. Check user limits
  const limitConfig =
    (variant.limitConfiguration as LimitConfiguration | undefined) ||
    (product.limitConfiguration as LimitConfiguration | undefined);

  if (limitConfig) {
    const limitId =
      limitConfig.limitType === "PER_VARIANT"
        ? `${productId}#${variantId}`
        : productId;

    const limitResponse = await dynamoClient.send(
      new GetItemCommand({
        TableName: genericConfig.StoreLimitsTableName,
        Key: marshall({ userId, limitId }),
      }),
    );

    const currentQuantity = limitResponse.Item
      ? (unmarshall(limitResponse.Item).quantity as number) || 0
      : 0;

    if (currentQuantity + quantity > limitConfig.maxQuantity) {
      logger.info(
        {
          userId,
          limitId,
          currentQuantity,
          requested: quantity,
          max: limitConfig.maxQuantity,
        },
        "User limit exceeded",
      );
      throw new LimitExceededError({
        message: `Purchase limit of ${limitConfig.maxQuantity} exceeded. You have already purchased ${currentQuantity}.`,
      });
    }
  }

  // 5. Check membership for pricing
  const isMember = isVerifiedIdentity
    ? await checkUserMembership({
        userId,
        memberLists: (variant.memberLists as string[]) || [],
        dynamoClient,
        redisClient,
        logger,
      })
    : false;

  const priceId = isMember
    ? (variant.memberPriceId as string)
    : (variant.nonmemberPriceId as string);

  return {
    priceId,
    isMemberPrice: isMember,
  };
}

// ============ Checkout Functions ============

export type CreateStoreCheckoutInputs = {
  userId: string;
  items: CreateCheckoutRequest["items"];
  successUrl?: string;
  cancelUrl?: string;
  dynamoClient: DynamoDBClient;
  redisClient: Redis;
  stripeApiKey: string;
  logger: ValidLoggers;
  baseUrl: string;
  isVerifiedIdentity: boolean;
};

export type CreateStoreCheckoutOutputs = {
  checkoutUrl: string;
  orderId: string;
  expiresAt: number;
};

export async function createStoreCheckout({
  userId,
  items,
  successUrl,
  cancelUrl,
  dynamoClient,
  redisClient,
  stripeApiKey,
  logger,
  baseUrl,
  isVerifiedIdentity,
}: CreateStoreCheckoutInputs): Promise<CreateStoreCheckoutOutputs> {
  const orderId = `ord_${randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 24 * 60 * 60; // 24 hours to complete checkout

  // 1. Validate all items are sellable and get price IDs
  const lineItems = await Promise.all(
    items.map(async (item) => {
      const sellableResult = await checkItemSellable({
        userId, // Always pass userId for purchase limit enforcement
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        dynamoClient,
        redisClient,
        logger,
        isVerifiedIdentity,
      });

      if (!sellableResult) {
        throw new ItemNotAvailableError({
          message: `Item ${item.productId}/${item.variantId} is not available for purchase.`,
        });
      }

      return {
        ...item,
        priceId: sellableResult.priceId,
        isMemberPrice: sellableResult.isMemberPrice,
      };
    }),
  );

  // 2. Create order record with PENDING status
  const orderItem = {
    orderId,
    lineItemId: "ORDER", // Special line item ID for order metadata
    userId,
    status: "PENDING",
    createdAt: now,
    expiresAt,
  };

  const transactItems: TransactWriteItemsCommandInput["TransactItems"] = [
    {
      Put: {
        TableName: genericConfig.StoreCartsOrdersTableName,
        Item: marshall(orderItem, { removeUndefinedValues: true }),
        ConditionExpression: "attribute_not_exists(orderId)",
      },
    },
  ];

  // Add line items
  for (let i = 0; i < lineItems.length; i++) {
    const li = lineItems[i];
    transactItems!.push({
      Put: {
        TableName: genericConfig.StoreCartsOrdersTableName,
        Item: marshall(
          {
            orderId,
            lineItemId: `LINE_${i}`,
            productId: li.productId,
            variantId: li.variantId,
            quantity: li.quantity,
            priceId: li.priceId,
            createdAt: now,
            itemId: `${li.productId}#${li.variantId}`, // For GSI
            expiresAt,
          },
          { removeUndefinedValues: true },
        ),
      },
    });
  }

  try {
    await retryDynamoTransactionWithBackoff(
      () =>
        dynamoClient.send(
          new TransactWriteItemsCommand({ TransactItems: transactItems }),
        ),
      logger,
      "CreateStoreCheckout",
    );
  } catch (error) {
    logger.error({ error, orderId }, "Failed to create order in DynamoDB");
    throw new DatabaseInsertError({ message: "Failed to create order." });
  }

  // 3. Check if user has a Stripe customer ID (only if verified identity)
  let stripeCustomerId: string | undefined;

  if (isVerifiedIdentity) {
    const netId = getNetIdFromEmail(userId);
    const userIdentity = await getUserIdentity({ netId, dynamoClient, logger });
    stripeCustomerId = userIdentity?.stripeCustomerId;
  }

  // 4. Create Stripe checkout session with capture_method: manual (pre-auth only)
  const metadata = {
    orderId,
    userId,
    initiator: "acm-store",
  };

  const checkoutParams = {
    stripeApiKey,
    items: lineItems.map((li) => ({
      price: li.priceId,
      quantity: li.quantity,
    })),
    initiator: "acm-store",
    metadata,
    allowPromotionCodes: false,
    successUrl: successUrl || `${baseUrl}/store/order/${orderId}?success=true`,
    returnUrl: cancelUrl || `${baseUrl}/store/cart?cancelled=true`,
    captureMethod: "manual" as const,
  };

  let checkoutUrl: string;
  if (isVerifiedIdentity && stripeCustomerId) {
    // Use existing Stripe customer (only for verified identities)
    logger.info(
      { userId, stripeCustomerId },
      "Using existing Stripe customer for verified identity",
    );
    checkoutUrl = await createCheckoutSessionWithCustomer({
      ...checkoutParams,
      customerId: stripeCustomerId,
    });
  } else {
    // Use email-based checkout (for unverified or no existing customer)
    logger.info({ userId, isVerifiedIdentity }, "Creating checkout with email");
    checkoutUrl = await createCheckoutSession({
      ...checkoutParams,
      customerEmail: userId,
    });
  }

  return {
    checkoutUrl,
    orderId,
    expiresAt,
  };
}
// ============ Webhook Processing ============

export type ProcessStoreWebhookInputs = {
  orderId: string;
  userId: string;
  paymentIntentId: string;
  dynamoClient: DynamoDBClient;
  stripeApiKey: string;
  logger: ValidLoggers;
};

export async function processStorePaymentSuccess({
  orderId,
  userId,
  paymentIntentId,
  dynamoClient,
  stripeApiKey,
  logger,
}: ProcessStoreWebhookInputs) {
  const now = Math.floor(Date.now() / 1000);

  // 1. Get order details
  const orderResponse = await dynamoClient.send(
    new QueryCommand({
      TableName: genericConfig.StoreCartsOrdersTableName,
      KeyConditionExpression: "orderId = :oid",
      ExpressionAttributeValues: marshall({ ":oid": orderId }),
    }),
  );

  if (!orderResponse.Items || orderResponse.Items.length === 0) {
    logger.error({ orderId }, "Order not found for webhook");
    throw new ValidationError({ message: "Order not found." });
  }

  const items = orderResponse.Items.map((i) => unmarshall(i));
  const orderMeta = items.find((i) => i.lineItemId === "ORDER");
  const lineItems = items.filter((i) => i.lineItemId !== "ORDER");

  if (!orderMeta) {
    logger.error({ orderId }, "Order metadata not found");
    throw new ValidationError({ message: "Order metadata not found." });
  }

  // Idempotency Check - Already completed successfully
  if (orderMeta.status === "ACTIVE") {
    logger.info({ orderId }, "Order already processed successfully");
    return; // Success, no retry needed
  }

  // Invalid state - don't retry
  if (orderMeta.status !== "PENDING" && orderMeta.status !== "CAPTURING") {
    logger.warn(
      { orderId, status: orderMeta.status },
      "Order in unexpected state",
    );
    throw new ValidationError({
      message: `Order in ${orderMeta.status} state, cannot process`,
    });
  }

  const isRetryAfterDynamoDB = orderMeta.status === "CAPTURING";

  // 2. Build DynamoDB Transaction (inventory updates + status to CAPTURING)
  const transactItems: TransactWriteItemsCommandInput["TransactItems"] = [];

  // A. Update Order Status to CAPTURING & Remove expiresAt
  transactItems.push({
    Update: {
      TableName: genericConfig.StoreCartsOrdersTableName,
      Key: marshall({ orderId, lineItemId: "ORDER" }),
      UpdateExpression:
        "SET #status = :capturing, confirmedAt = :now, stripePaymentIntentId = :piId REMOVE expiresAt",
      ConditionExpression: "#status = :pendingStatus",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: marshall({
        ":capturing": "CAPTURING",
        ":pendingStatus": "PENDING",
        ":now": now,
        ":piId": paymentIntentId,
      }),
    },
  });

  // B. Process Inventory & Remove expiresAt from Line Items
  // Also collect limit updates to aggregate by limitId to avoid operation errors
  const limitUpdates = new Map<
    string,
    { limitConfig: LimitConfiguration; totalQty: number }
  >();

  // Track product-level inventory updates to aggregate across line items
  const productInventoryUpdates = new Map<
    string,
    { product: Record<string, unknown>; totalQty: number }
  >();

  for (const lineItem of lineItems) {
    // 1. Add update to remove expiresAt from the line item record
    transactItems.push({
      Update: {
        TableName: genericConfig.StoreCartsOrdersTableName,
        Key: marshall({ orderId, lineItemId: lineItem.lineItemId }),
        UpdateExpression: "REMOVE expiresAt",
      },
    });

    // 2. Fetch Product/Variant Data for Inventory
    const { productId, variantId, quantity } = lineItem;

    const [productData, variantData] = await Promise.all([
      dynamoClient.send(
        new GetItemCommand({
          TableName: genericConfig.StoreInventoryTableName,
          Key: marshall({ productId, variantId: DEFAULT_VARIANT_ID }),
        }),
      ),
      dynamoClient.send(
        new GetItemCommand({
          TableName: genericConfig.StoreInventoryTableName,
          Key: marshall({ productId, variantId }),
        }),
      ),
    ]);

    const product = productData.Item ? unmarshall(productData.Item) : null;
    const variant = variantData.Item ? unmarshall(variantData.Item) : null;

    const inventoryMode = (product?.inventoryMode as string) || "PER_VARIANT";

    if (inventoryMode === "PER_PRODUCT") {
      // Aggregate product-level inventory updates
      const existing = productInventoryUpdates.get(productId);
      if (existing) {
        existing.totalQty += quantity;
      } else {
        productInventoryUpdates.set(productId, {
          product: product!,
          totalQty: quantity,
        });
      }

      // Still track per-variant soldCount for reporting (no condition check)
      transactItems.push({
        Update: {
          TableName: genericConfig.StoreInventoryTableName,
          Key: marshall({ productId, variantId }),
          UpdateExpression:
            "SET soldCount = if_not_exists(soldCount, :zero) + :qty",
          ExpressionAttributeValues: marshall({
            ":qty": quantity,
            ":zero": 0,
          }),
        },
      });
    } else {
      // PER_VARIANT mode - existing logic
      const isLimited =
        variant &&
        variant.inventoryCount !== null &&
        variant.inventoryCount !== undefined;

      if (isLimited) {
        // LIMITED: Decrement inventory + Increment sold + Condition Check
        transactItems.push({
          Update: {
            TableName: genericConfig.StoreInventoryTableName,
            Key: marshall({ productId, variantId }),
            UpdateExpression:
              "SET inventoryCount = inventoryCount - :qty, soldCount = if_not_exists(soldCount, :zero) + :qty",
            ConditionExpression: "inventoryCount >= :qty",
            ExpressionAttributeValues: marshall({
              ":qty": quantity,
              ":zero": 0,
            }),
          },
        });
      } else {
        // UNLIMITED: Only Increment sold (No inventory decrement, No condition)
        transactItems.push({
          Update: {
            TableName: genericConfig.StoreInventoryTableName,
            Key: marshall({ productId, variantId }),
            UpdateExpression:
              "SET soldCount = if_not_exists(soldCount, :zero) + :qty",
            ExpressionAttributeValues: marshall({
              ":qty": quantity,
              ":zero": 0,
            }),
          },
        });
      }
    }

    // --- USER LIMITS (aggregate by limitId) ---
    const limitConfig =
      (variant?.limitConfiguration as LimitConfiguration | undefined) ||
      (product?.limitConfiguration as LimitConfiguration | undefined);

    if (limitConfig) {
      const limitId =
        limitConfig.limitType === "PER_VARIANT"
          ? `${productId}#${variantId}`
          : productId;

      const existing = limitUpdates.get(limitId);
      if (existing) {
        existing.totalQty += quantity;
      } else {
        limitUpdates.set(limitId, { limitConfig, totalQty: quantity });
      }
    }
  }

  // C. Add aggregated product-level inventory updates
  for (const [productId, { product, totalQty }] of productInventoryUpdates) {
    const totalInventoryCount = product.totalInventoryCount as
      | number
      | null
      | undefined;
    const isLimited =
      totalInventoryCount !== null && totalInventoryCount !== undefined;

    if (isLimited) {
      // LIMITED: Decrement totalInventoryCount + Increment totalSoldCount + Condition Check
      transactItems.push({
        Update: {
          TableName: genericConfig.StoreInventoryTableName,
          Key: marshall({ productId, variantId: DEFAULT_VARIANT_ID }),
          UpdateExpression:
            "SET totalInventoryCount = totalInventoryCount - :qty, totalSoldCount = if_not_exists(totalSoldCount, :zero) + :qty",
          ConditionExpression: "totalInventoryCount >= :qty",
          ExpressionAttributeValues: marshall({
            ":qty": totalQty,
            ":zero": 0,
          }),
        },
      });
    } else {
      // UNLIMITED: Just track totalSoldCount (no condition)
      transactItems.push({
        Update: {
          TableName: genericConfig.StoreInventoryTableName,
          Key: marshall({ productId, variantId: DEFAULT_VARIANT_ID }),
          UpdateExpression:
            "SET totalSoldCount = if_not_exists(totalSoldCount, :zero) + :qty",
          ExpressionAttributeValues: marshall({
            ":qty": totalQty,
            ":zero": 0,
          }),
        },
      });
    }
  }

  // D. Add aggregated user limit updates to the transaction
  for (const [limitId, { limitConfig, totalQty }] of limitUpdates) {
    transactItems.push({
      Update: {
        TableName: genericConfig.StoreLimitsTableName,
        Key: marshall({ userId, limitId }),
        UpdateExpression:
          "SET quantity = if_not_exists(quantity, :zero) + :qty",
        ConditionExpression:
          "(attribute_not_exists(quantity) AND :qty <= :maxQuantity) OR quantity <= :maxMinusQty",
        ExpressionAttributeValues: marshall({
          ":qty": totalQty,
          ":zero": 0,
          ":maxMinusQty": limitConfig.maxQuantity - totalQty,
          ":maxQuantity": limitConfig.maxQuantity,
        }),
      },
    });
  }

  // 4. Execute Transaction (PENDING -> CAPTURING with inventory updates)
  if (!isRetryAfterDynamoDB) {
    try {
      await retryDynamoTransactionWithBackoff(
        () =>
          dynamoClient.send(
            new TransactWriteItemsCommand({ TransactItems: transactItems }),
          ),
        logger,
        "ProcessStorePaymentSuccess",
      );
      logger.info({ orderId }, "Inventory reserved, order in CAPTURING state");
    } catch (error: any) {
      if (error.name === "TransactionCanceledException") {
        const reasons = error.CancellationReasons || [];

        // Check if order status condition failed (already processed)
        if (reasons[0]?.Code === "ConditionalCheckFailed") {
          logger.warn({ orderId }, "Order already processed (not PENDING)");
          // Recursive retry to handle state
          return processStorePaymentSuccess({
            orderId,
            userId,
            paymentIntentId,
            dynamoClient,
            stripeApiKey,
            logger,
          });
        }

        // Check for Conditional Failures in inventory or limits
        const failedIndex = reasons.findIndex(
          (r: any, index: number) =>
            index > 0 && r.Code === "ConditionalCheckFailed",
        );

        if (failedIndex > 0) {
          const failedItem = transactItems[failedIndex];
          const isLimitFailure =
            failedItem.Update?.TableName === genericConfig.StoreLimitsTableName;
          const isProductInventoryFailure =
            failedItem.Update?.TableName ===
              genericConfig.StoreInventoryTableName &&
            failedItem.Update?.Key &&
            unmarshall(failedItem.Update.Key).variantId === DEFAULT_VARIANT_ID;

          let errorLogMsg: string;
          if (isLimitFailure) {
            errorLogMsg = "User limit check failed, cancelling payment";
          } else if (isProductInventoryFailure) {
            errorLogMsg =
              "Product-level inventory check failed (OOS), cancelling payment";
          } else {
            errorLogMsg =
              "Variant inventory check failed (OOS), cancelling payment";
          }

          logger.error({ orderId, failedIndex }, errorLogMsg);

          // Payment NOT captured yet, so we can cancel/void it
          const cancelIdempotencyKey = `${orderId}-cancel`;
          try {
            await retryWithBackoff(
              async () => {
                await cancelPaymentIntent({
                  idempotencyKey: cancelIdempotencyKey,
                  paymentIntentId,
                  stripeApiKey,
                  cancellationReason: "abandoned",
                });
              },
              {
                shouldRetry: shouldRetryStripeError,
                onRetry: logOnRetry("CancelPaymentIntent", logger),
              },
            );
            logger.info({ orderId }, "Payment cancelled successfully");
          } catch (e) {
            logger.error(
              { e, orderId },
              "Failed to cancel payment after inventory/limit failure",
            );
            throw new InternalServerError({
              message: "Failed to cancel payment after failure",
            });
          }

          // Update order to CANCELLED
          try {
            await dynamoClient.send(
              new UpdateItemCommand({
                TableName: genericConfig.StoreCartsOrdersTableName,
                Key: marshall({ orderId, lineItemId: "ORDER" }),
                UpdateExpression:
                  "SET #status = :cancelled, cancelledAt = :now",
                ExpressionAttributeNames: { "#status": "status" },
                ExpressionAttributeValues: marshall({
                  ":cancelled": "CANCELLED",
                  ":now": now,
                }),
              }),
            );
            logger.info(
              { orderId, lineItemCount: lineItems.length },
              "Order marked as CANCELLED",
            );
          } catch (e) {
            logger.error(
              { e, orderId },
              "Failed to update order status to CANCELLED",
            );
            throw new InternalServerError({
              message: "Failed to update order status after cancellation",
            });
          }

          // Don't throw - order is handled (cancelled)
          return;
        }
      }

      // Unexpected transaction error
      logger.error(
        { error, orderId },
        "Transaction failed during inventory reservation",
      );
      throw error;
    }
  } else {
    logger.info(
      { orderId },
      "Order already in CAPTURING state, skipping to payment capture",
    );
  }

  // 5. Capture Payment (deterministic idempotency key)
  const captureIdempotencyKey = `${orderId}-capture`;

  try {
    await retryWithBackoff(
      async () => {
        await capturePaymentIntent({
          idempotencyKey: captureIdempotencyKey,
          paymentIntentId,
          stripeApiKey,
        });
      },
      {
        shouldRetry: shouldRetryStripeError,
        onRetry: logOnRetry("CapturePaymentIntent", logger),
      },
    );
    logger.info({ orderId }, "Payment captured successfully");
  } catch (e) {
    logger.error(
      { e, orderId },
      "Capture failed after retries, will retry on webhook",
    );
    // Inventory is already decremented, payment will be captured on retry
    throw new InternalServerError({
      message: "Failed to capture payment, will retry",
    });
  }

  // 6. Update Order Status to ACTIVE
  try {
    await dynamoClient.send(
      new UpdateItemCommand({
        TableName: genericConfig.StoreCartsOrdersTableName,
        Key: marshall({ orderId, lineItemId: "ORDER" }),
        UpdateExpression: "SET #status = :active",
        ConditionExpression: "#status = :capturing",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: marshall({
          ":active": "ACTIVE",
          ":capturing": "CAPTURING",
        }),
      }),
    );
    logger.info({ orderId }, "Order completed successfully - status ACTIVE");
  } catch (error: any) {
    if (error.name === "ConditionalCheckFailedException") {
      logger.warn({ orderId }, "Order already ACTIVE");
      return; // Success, already completed
    }
    logger.error(
      { error, orderId },
      "Failed to update order to ACTIVE after capture",
    );
    throw new InternalServerError({
      message: "Failed to finalize order status",
    });
  }

  logger.info({ orderId }, "Order processing completed successfully");
}

// ============ Order Management Functions ============

export async function getOrder({
  orderId,
  dynamoClient,
}: {
  orderId: string;
  dynamoClient: DynamoDBClient;
}): Promise<Order & { lineItems: LineItem[] }> {
  const response = await dynamoClient.send(
    new QueryCommand({
      TableName: genericConfig.StoreCartsOrdersTableName,
      KeyConditionExpression: "orderId = :oid",
      ExpressionAttributeValues: marshall({ ":oid": orderId }),
    }),
  );

  if (!response.Items || response.Items.length === 0) {
    throw new OrderNotFoundError({ message: "Order not found." });
  }

  const items = response.Items.map((i) => unmarshall(i));
  const orderMeta = items.find((i) => i.lineItemId === "ORDER");
  const lineItems = items.filter((i) => i.lineItemId !== "ORDER");

  if (!orderMeta) {
    throw new OrderNotFoundError({ message: "Order metadata not found." });
  }

  return {
    orderId: orderMeta.orderId as string,
    userId: orderMeta.userId as string,
    status: orderMeta.status as Order["status"],
    stripePaymentIntentId: orderMeta.stripePaymentIntentId as
      | string
      | undefined,
    createdAt: orderMeta.createdAt as number,
    confirmedAt: orderMeta.confirmedAt as number | undefined,
    cancelledAt: orderMeta.cancelledAt as number | undefined,
    refundId: orderMeta.refundId as string | undefined,
    expiresAt: orderMeta.expiresAt as number | undefined,
    lineItems: lineItems.map((li) => ({
      orderId: li.orderId as string,
      lineItemId: li.lineItemId as string,
      productId: li.productId as string,
      variantId: li.variantId as string,
      quantity: li.quantity as number,
      priceId: li.priceId as string,
      unitPriceCents: li.unitPriceCents as number | undefined,
      createdAt: li.createdAt as number,
      itemId: li.itemId as string | undefined,
      isFulfilled: (li.isFulfilled as boolean) ?? false,
      userId: li.userId as string,
    })),
  };
}

export async function listProductLineItems({
  dynamoClient,
  productId,
  logger,
}: {
  dynamoClient: DynamoDBClient;
  productId: string;
  logger: ValidLoggers;
}) {
  const queryParams: QueryCommandInput = {
    TableName: genericConfig.StoreCartsOrdersTableName,
    KeyConditionExpression: "productId = :productId",
    IndexName: "ProductIdIndex",
    ExpressionAttributeValues: marshall({
      ":productId": productId,
    }),
  };

  const lineItems: Record<string, unknown>[] = [];
  let lastEvaluatedKey: Record<string, AttributeValue> | undefined;
  do {
    const response = await dynamoClient.send(
      new QueryCommand({
        ...queryParams,
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );
    if (response.Items) {
      lineItems.push(...response.Items.map((i) => unmarshall(i)));
    }
    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  if (lineItems.length === 0) {
    return [];
  }

  // Get unique order IDs to fetch order metadata
  const uniqueOrderIds = [
    ...new Set(lineItems.map((li) => li.orderId as string)),
  ];

  // BatchGetItem has a limit of 100 items per request, so we need to chunk
  const chunkSize = 100;
  const chunks: string[][] = [];

  for (let i = 0; i < uniqueOrderIds.length; i += chunkSize) {
    chunks.push(uniqueOrderIds.slice(i, i + chunkSize));
  }

  class UnprocessedKeysError extends Error {
    constructor() {
      super("BatchGetItem returned unprocessed keys");
      this.name = "UnprocessedKeysError";
    }
  }

  // Process all chunks in parallel
  const batchResults = await Promise.all(
    chunks.map(async (chunk) => {
      const results: {
        orderId: string;
        userId: string;
        status: Order["status"];
      }[] = [];
      let keysToFetch = chunk.map((orderId) =>
        marshall({ orderId, lineItemId: "ORDER" }),
      );

      await retryWithBackoff(
        async () => {
          const batchGetResponse = await dynamoClient.send(
            new BatchGetItemCommand({
              RequestItems: {
                [genericConfig.StoreCartsOrdersTableName]: {
                  Keys: keysToFetch,
                  ProjectionExpression: "orderId, userId, #status",
                  ExpressionAttributeNames: { "#status": "status" },
                },
              },
            }),
          );

          const orderItems =
            batchGetResponse.Responses?.[
              genericConfig.StoreCartsOrdersTableName
            ] || [];

          for (const item of orderItems) {
            const unmarshalled = unmarshall(item);
            results.push({
              orderId: unmarshalled.orderId as string,
              userId: unmarshalled.userId as string,
              status: unmarshalled.status as Order["status"],
            });
          }

          const unprocessedKeys =
            batchGetResponse.UnprocessedKeys?.[
              genericConfig.StoreCartsOrdersTableName
            ]?.Keys;

          if (unprocessedKeys && unprocessedKeys.length > 0) {
            keysToFetch = unprocessedKeys;
            throw new UnprocessedKeysError();
          }
        },
        {
          maxRetries: 3,
          shouldRetry: (error) => error instanceof UnprocessedKeysError,
          onRetry: logOnRetry("BatchGetOrderMetadata", logger),
        },
      );

      return results;
    }),
  );

  // Flatten results and build the map
  const orderMetadataMap = new Map<
    string,
    { userId: string; status: Order["status"] }
  >();

  for (const results of batchResults) {
    for (const result of results) {
      orderMetadataMap.set(result.orderId, {
        userId: result.userId,
        status: result.status,
      });
    }
  }

  return lineItems.map((i) => {
    const orderMeta = orderMetadataMap.get(i.orderId as string);
    return {
      orderId: i.orderId as string,
      lineItemId: i.lineItemId as string,
      createdAt: i.createdAt as number,
      expiresAt: i.expiresAt as number,
      priceId: i.priceId as string,
      productId: i.productId as string,
      quantity: i.quantity as number,
      variantId: i.variantId as string,
      isFulfilled: (i.isFulfilled as boolean) ?? false,
      userId: orderMeta?.userId as string,
      status: orderMeta?.status as Order["status"],
    };
  });
}

export type CreateProductInputs = {
  productData: CreateProductRequest;
  dynamoClient: DynamoDBClient;
  stripeApiKey: string;
  logger: ValidLoggers;
  actor: string;
};

export async function createProduct({
  productData,
  dynamoClient,
  stripeApiKey,
  actor,
  logger,
}: CreateProductInputs): Promise<void> {
  const stripeClient = new Stripe(stripeApiKey);
  const { variants, ...productMeta } = productData;
  const now = Math.floor(Date.now() / 1000);
  if (
    productMeta.inventoryMode === "PER_PRODUCT" &&
    productMeta.totalInventoryCount === undefined
  ) {
    throw new ValidationError({
      message:
        "totalInventoryCount is required when inventoryMode is PER_PRODUCT",
    });
  }
  if (variants.length > 24) {
    throw new ValidationError({
      message: "Too many variants.",
    });
  }

  // 1. Create Product in Stripe
  let stripeProduct: Stripe.Product;
  try {
    stripeProduct = await stripeClient.products.create({
      name: productMeta.name,
      description: productMeta.description,
      metadata: {
        productId: productMeta.productId,
        source: "acm-store-api",
      },
    });
  } catch (err) {
    logger.error({ err }, "Failed to create Stripe product");
    throw new InternalServerError({
      message: "Failed to create product in Stripe.",
    });
  }

  // 2. Create Prices in Stripe for each variant
  const createdPriceIds: string[] = [];
  let dbVariants = [];

  try {
    dbVariants = await Promise.all(
      variants.map(async (variant) => {
        const variantId = randomUUID();

        // Concurrently create Member and Non-Member prices
        const [memberPrice, nonMemberPrice] = await Promise.all([
          stripeClient.prices.create({
            product: stripeProduct.id,
            currency: "usd",
            unit_amount: variant.memberPriceCents,
            metadata: {
              variantId,
              type: "member",
            },
          }),
          stripeClient.prices.create({
            product: stripeProduct.id,
            currency: "usd",
            unit_amount: variant.nonmemberPriceCents,
            metadata: {
              variantId,
              type: "non_member",
            },
          }),
        ]);

        // Push to local array for potential cleanup
        createdPriceIds.push(memberPrice.id, nonMemberPrice.id);

        return {
          ...variant,
          variantId,
          productId: productMeta.productId,
          memberPriceId: memberPrice.id,
          nonmemberPriceId: nonMemberPrice.id,
          soldCount: 0,
        };
      }),
    );
  } catch (err) {
    // Cleanup: Deactivate Product and any successfully created Prices
    try {
      await stripeClient.products.update(stripeProduct.id, { active: false });
      await Promise.all(
        createdPriceIds.map((id) =>
          stripeClient.prices.update(id, { active: false }),
        ),
      );

      // Log initial error with note that cleanup succeeded
      logger.error(
        { err, stripeProductId: stripeProduct.id },
        "Failed to create Stripe prices; orphaned resources deactivated.",
      );
    } catch (cleanupErr) {
      // Log both errors if cleanup fails
      logger.error(
        { err, cleanupErr, stripeProductId: stripeProduct.id },
        "Failed to create Stripe prices and failed to cleanup orphaned resources.",
      );
    }

    throw new InternalServerError({
      message: "Failed to create variant prices in payment provider.",
    });
  }

  // 3. Prepare DynamoDB Transaction
  const transactItems: TransactWriteItemsCommandInput["TransactItems"] = [];

  // Add Product Metadata (DEFAULT variant)
  transactItems.push({
    Put: {
      TableName: genericConfig.StoreInventoryTableName,
      Item: marshall(
        {
          ...productMeta,
          stripeProductId: stripeProduct.id, // Injected
          variantId: DEFAULT_VARIANT_ID,
          createdAt: now,
          inventoryMode: productMeta.inventoryMode || "PER_VARIANT",
          ...(productMeta.inventoryMode === "PER_PRODUCT" && {
            totalInventoryCount: productMeta.totalInventoryCount,
            totalSoldCount: 0,
          }),
        },
        { removeUndefinedValues: true },
      ),
      ConditionExpression: "attribute_not_exists(productId)",
    },
  });

  // Add Variants
  for (const dbVariant of dbVariants) {
    transactItems.push({
      Put: {
        TableName: genericConfig.StoreInventoryTableName,
        Item: marshall(
          {
            ...dbVariant,
            createdAt: now,
            soldCount: 0,
            ...(productMeta.inventoryMode !== "PER_PRODUCT" && {
              inventoryCount: dbVariant.inventoryCount,
            }),
          },
          { removeUndefinedValues: true },
        ),
      },
    });
  }

  // 4. Execute Transaction
  try {
    await retryDynamoTransactionWithBackoff(
      () =>
        dynamoClient.send(
          new TransactWriteItemsCommand({ TransactItems: transactItems }),
        ),
      logger,
      "CreateProduct",
    );
  } catch (error: unknown) {
    const err = error as { name?: string };
    logger.error("Error creating product", err);
    if (err.name === "TransactionCanceledException") {
      logger.warn(
        { productId: productMeta.productId },
        "Product creation failed: Product ID already exists",
      );
      throw new DatabaseInsertError({
        message: "Product creation failed. Product ID may already exist.",
      });
    }
    logger.error(
      { error, productId: productMeta.productId },
      "Failed to create product in DB",
    );
    throw new DatabaseInsertError({ message: "Failed to create product." });
  }

  // 5. Write Audit Logs (separate transaction, best-effort)
  try {
    const auditItems: TransactWriteItemsCommandInput["TransactItems"] = [];

    // Product audit log
    const productAuditLog = buildAuditLogTransactPut({
      entry: {
        module: Modules.STORE,
        actor,
        target: productMeta.productId,
        message: `Created product "${productMeta.name}" with ${dbVariants.length} variant(s). Stripe Product ID: ${stripeProduct.id}`,
      },
    });
    if (productAuditLog) {
      auditItems.push(productAuditLog);
    }

    // Variant audit logs
    for (const dbVariant of dbVariants) {
      const variantAuditLog = buildAuditLogTransactPut({
        entry: {
          module: Modules.STORE,
          actor,
          target: `${productMeta.productId}#${dbVariant.variantId}`,
          message: `Created variant "${dbVariant.name}" (inventory: ${dbVariant.inventoryCount ?? "unlimited"}, member: $${(dbVariant.memberPriceCents / 100).toFixed(2)}, non-member: $${(dbVariant.nonmemberPriceCents / 100).toFixed(2)})`,
        },
      });
      if (variantAuditLog) {
        auditItems.push(variantAuditLog);
      }
    }

    if (auditItems.length > 0) {
      await retryDynamoTransactionWithBackoff(
        () =>
          dynamoClient.send(
            new TransactWriteItemsCommand({ TransactItems: auditItems }),
          ),
        logger,
        "CreateProduct_AuditLog",
      );
    }
  } catch (auditError) {
    // Log but don't fail the operation if audit logging fails
    logger.error(
      { auditError, productId: productMeta.productId },
      "Failed to write audit logs for product creation",
    );
  }
}
