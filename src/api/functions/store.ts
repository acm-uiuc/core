import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
  ScanInput,
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
import { buildAuditLogTransactPut } from "./auditLog.js";
import { Modules } from "common/modules.js";
import {
  createCheckoutSession,
  createCheckoutSessionWithCustomer,
  capturePaymentIntent,
  cancelPaymentIntent,
} from "./stripe.js";
import { getUserIdentity } from "./identity.js";
import { retryDynamoTransactionWithBackoff } from "api/utils.js";
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
} from "common/types/store.js";
import Stripe from "stripe";

// ============ Helper Functions ============

export function getNetIdFromEmail(email: string): string {
  const [netId] = email.split("@");
  return netId.toLowerCase();
}

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

  // Return true if any check succeeded and returned true
  return results.some(
    (result) => result.status === "fulfilled" && result.value === true,
  );
}

// ============ Product/Inventory Functions ============

export async function getProduct({
  productId,
  dynamoClient,
}: {
  productId: string;
  dynamoClient: DynamoDBClient;
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

  return {
    productId: defaultVariant.productId,
    name: defaultVariant.name,
    description: defaultVariant.description,
    imageUrl: defaultVariant.imageUrl,
    openAt: defaultVariant.openAt,
    closeAt: defaultVariant.closeAt,
    stripeProductId: defaultVariant.stripeProductId,
    limitConfiguration: defaultVariant.limitConfiguration,
    variants: variants.map((v) => ({
      variantId: v.variantId,
      name: v.name,
      description: v.description,
      imageUrl: v.imageUrl,
      memberLists: v.memberLists,
      memberPriceId: v.memberPriceId,
      nonmemberPriceId: v.nonmemberPriceId,
      inventoryCount: v.inventoryCount,
      soldCount: v.soldCount || 0,
      exchangesAllowed: v.exchangesAllowed || false,
      limitConfiguration: v.limitConfiguration,
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
  const { Items } = await dynamoClient.send(
    new ScanCommand({
      TableName: genericConfig.StoreInventoryTableName,
    }),
  );

  if (!Items || Items.length === 0) {
    return [];
  }

  // Group by productId
  const productMap = new Map<
    string,
    { product?: Record<string, unknown>; variants: Record<string, unknown>[] }
  >();

  for (const item of Items.map((i) => unmarshall(i))) {
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

    products.push({
      productId: p.productId as string,
      name: p.name as string,
      description: p.description as string | undefined,
      imageUrl: p.imageUrl as string | undefined,
      openAt: p.openAt as number | undefined,
      closeAt: p.closeAt as number | undefined,
      stripeProductId: p.stripeProductId as string | undefined,
      limitConfiguration: p.limitConfiguration as
        | LimitConfiguration
        | undefined,
      variants: data.variants.map((v) => ({
        variantId: v.variantId as string,
        name: v.name as string,
        description: v.description as string | undefined,
        imageUrl: v.imageUrl as string | undefined,
        memberLists: v.memberLists as string[] | undefined,
        memberPriceId: v.memberPriceId as string,
        nonmemberPriceId: v.nonmemberPriceId as string,
        inventoryCount: v.inventoryCount as number | null | undefined,
        soldCount: (v.soldCount as number) || 0,
        exchangesAllowed: (v.exchangesAllowed as boolean) || false,
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
};

export async function checkItemSellable({
  userId,
  productId,
  variantId,
  quantity,
  dynamoClient,
  redisClient,
  logger,
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

  // 3. Check inventory (UPDATED FOR ATOMIC DECREMENT MODEL)
  // Logic: inventoryCount now tracks *Remaining* stock directly.
  // If the field is null/undefined, we treat it as infinite stock.
  if (variant.inventoryCount !== null && variant.inventoryCount !== undefined) {
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
  const isMember = await checkUserMembership({
    userId,
    memberLists: (variant.memberLists as string[]) || [],
    dynamoClient,
    redisClient,
    logger,
  });

  const priceId = isMember
    ? (variant.memberPriceId as string)
    : (variant.nonmemberPriceId as string);

  return {
    priceId,
    unitPriceCents: 0,
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
}: CreateStoreCheckoutInputs): Promise<CreateStoreCheckoutOutputs> {
  const orderId = `ord_${randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 24 * 60 * 60; // 24 hours

  // 1. Validate all items are sellable and get price IDs
  const lineItems: Array<{
    productId: string;
    variantId: string;
    quantity: number;
    priceId: string;
    isMemberPrice: boolean;
  }> = [];

  for (const item of items) {
    const sellableResult = await checkItemSellable({
      userId,
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity,
      dynamoClient,
      redisClient,
      logger,
    });

    if (!sellableResult) {
      throw new ItemNotAvailableError({
        message: `Item ${item.productId}/${item.variantId} is not available for purchase.`,
      });
    }

    lineItems.push({
      ...item,
      priceId: sellableResult.priceId,
      isMemberPrice: sellableResult.isMemberPrice,
    });
  }

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
          },
          { removeUndefinedValues: true },
        ),
      },
    });
  }

  // Add audit log
  const auditLog = buildAuditLogTransactPut({
    entry: {
      module: Modules.STORE,
      actor: userId,
      target: orderId,
      message: `Created checkout session with ${items.length} item(s)`,
    },
  });
  if (auditLog) {
    transactItems!.push(auditLog);
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

  // 3. Check if user has a Stripe customer ID
  const netId = getNetIdFromEmail(userId);
  const userIdentity = await getUserIdentity({ netId, dynamoClient, logger });
  const stripeCustomerId = userIdentity?.stripeCustomerId;

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
  if (stripeCustomerId) {
    // Use existing Stripe customer
    logger.info({ userId, stripeCustomerId }, "Using existing Stripe customer");
    checkoutUrl = await createCheckoutSessionWithCustomer({
      ...checkoutParams,
      customerId: stripeCustomerId,
    });
  } else {
    // Use email-based checkout
    logger.info(
      { userId },
      "Creating checkout with email (no Stripe customer)",
    );
    checkoutUrl = await createCheckoutSession({
      ...checkoutParams,
      customerEmail: userId,
    });
  }

  // 5. Update order with checkout session URL
  await dynamoClient.send(
    new UpdateItemCommand({
      TableName: genericConfig.StoreCartsOrdersTableName,
      Key: marshall({ orderId, lineItemId: "ORDER" }),
      UpdateExpression: "SET stripeCheckoutSessionId = :sessionUrl",
      ExpressionAttributeValues: marshall({ ":sessionUrl": checkoutUrl }),
    }),
  );

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
}: ProcessStoreWebhookInputs): Promise<{ success: boolean; error?: string }> {
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
    return { success: false, error: "Order not found" };
  }

  const items = orderResponse.Items.map((i) => unmarshall(i));
  const orderMeta = items.find((i) => i.lineItemId === "ORDER");
  const lineItems = items.filter((i) => i.lineItemId !== "ORDER");

  // Idempotency Check
  if (!orderMeta || orderMeta.status !== "PENDING") {
    if (orderMeta?.status === "ACTIVE") {
      return { success: true };
    }
    return { success: false, error: "Order not in pending status" };
  }

  // 2. Build Transaction
  const transactItems: TransactWriteItemsCommandInput["TransactItems"] = [];

  // A. Update Order Status
  transactItems.push({
    Update: {
      TableName: genericConfig.StoreCartsOrdersTableName,
      Key: marshall({ orderId, lineItemId: "ORDER" }),
      UpdateExpression:
        "SET #status = :newStatus, confirmedAt = :now, stripePaymentIntentId = :piId",
      ConditionExpression: "#status = :pendingStatus",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: marshall({
        ":newStatus": "ACTIVE",
        ":pendingStatus": "PENDING",
        ":now": now,
        ":piId": paymentIntentId,
      }),
    },
  });

  // B. Process Inventory
  // We MUST fetch current variant data to know if it is "Limited" or "Unlimited"
  // so we can construct the correct DynamoDB update expression.
  for (const lineItem of lineItems) {
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

    // --- LOGIC FOR UNLIMITED VS LIMITED ---
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
          // The atomic guard:
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

    // --- USER LIMITS ---
    const limitConfig =
      (variant?.limitConfiguration as LimitConfiguration | undefined) ||
      (product?.limitConfiguration as LimitConfiguration | undefined);

    if (limitConfig) {
      const limitId =
        limitConfig.limitType === "PER_VARIANT"
          ? `${productId}#${variantId}`
          : productId;

      transactItems.push({
        Update: {
          TableName: genericConfig.StoreLimitsTableName,
          Key: marshall({ userId, limitId }),
          UpdateExpression:
            "SET quantity = if_not_exists(quantity, :zero) + :qty",
          ExpressionAttributeValues: marshall({ ":qty": quantity, ":zero": 0 }),
        },
      });
    }
  }

  // 3. Audit Log
  const auditLog = buildAuditLogTransactPut({
    entry: {
      module: Modules.STORE,
      actor: "stripe-webhook",
      target: orderId,
      message: `Payment confirmed. Payment Intent: ${paymentIntentId}`,
    },
  });
  if (auditLog) {
    transactItems.push(auditLog);
  }

  // 4. Execute Transaction
  try {
    await retryDynamoTransactionWithBackoff(
      () =>
        dynamoClient.send(
          new TransactWriteItemsCommand({ TransactItems: transactItems }),
        ),
      logger,
      "ProcessStorePaymentSuccess",
    );
  } catch (error: any) {
    if (error.name === "TransactionCanceledException") {
      const reasons = error.CancellationReasons || [];

      // Check for Idempotency first (Order status failed)
      if (reasons[0]?.Code === "ConditionalCheckFailed") {
        logger.warn({ orderId }, "Order already processed");
        return { success: true };
      }

      // Check for Inventory Failure
      // Since we build the array dynamically, we look for any failure > 0
      const inventoryFailed = reasons.some(
        (r: any, index: number) =>
          index > 0 && r.Code === "ConditionalCheckFailed",
      );

      if (inventoryFailed) {
        logger.error(
          { orderId },
          "Inventory check failed (OOS), voiding payment",
        );
        try {
          await cancelPaymentIntent({
            paymentIntentId,
            stripeApiKey,
            cancellationReason: "abandoned",
          });
          await dynamoClient.send(
            new UpdateItemCommand({
              TableName: genericConfig.StoreCartsOrdersTableName,
              Key: marshall({ orderId, lineItemId: "ORDER" }),
              UpdateExpression: "SET #status = :cancelled, cancelledAt = :now",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: marshall({
                ":cancelled": "CANCELLED",
                ":now": now,
              }),
            }),
          );
        } catch (e) {
          logger.error({ e, orderId }, "Failed to refund/cancel after OOS");
        }
        return { success: false, error: "Insufficient inventory" };
      }
    }
    throw error;
  }

  // 5. Capture Payment
  try {
    await capturePaymentIntent({ paymentIntentId, stripeApiKey });
  } catch (e) {
    logger.error({ e, orderId }, "Manual capture required");
  }

  return { success: true };
}

export async function processStorePaymentFailure({
  orderId,
  paymentIntentId,
  dynamoClient,
  logger,
}: Omit<ProcessStoreWebhookInputs, "stripeApiKey">): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  try {
    // Update order status to CANCELLED
    await dynamoClient.send(
      new UpdateItemCommand({
        TableName: genericConfig.StoreCartsOrdersTableName,
        Key: marshall({ orderId, lineItemId: "ORDER" }),
        UpdateExpression: "SET #status = :cancelled, cancelledAt = :now",
        ConditionExpression: "#status = :pending",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: marshall({
          ":cancelled": "CANCELLED",
          ":pending": "PENDING",
          ":now": now,
        }),
      }),
    );

    logger.info(
      { orderId, paymentIntentId },
      "Marked order as cancelled due to payment failure",
    );
  } catch (error) {
    // If condition check fails, order may already be processed - that's OK
    logger.info(
      { orderId, error },
      "Could not cancel order - may already be processed",
    );
  }
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
    stripeCheckoutSessionId: orderMeta.stripeCheckoutSessionId as
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
    })),
  };
}

export async function listOrdersByUser({
  userId,
  dynamoClient,
  logger,
}: {
  userId: string;
  dynamoClient: DynamoDBClient;
  logger: ValidLoggers;
}): Promise<Order[]> {
  // Note: This uses a Scan with filter which is inefficient.
  // In production, add a GSI on userId for better performance.
  // For now, this works for low volume.
  const response = await dynamoClient.send(
    new ScanCommand({
      TableName: genericConfig.StoreCartsOrdersTableName,
      FilterExpression: "userId = :uid AND lineItemId = :orderMarker",
      ExpressionAttributeValues: marshall({
        ":uid": userId,
        ":orderMarker": "ORDER",
      }),
    }),
  );

  if (!response.Items) {
    return [];
  }

  return response.Items.map((i) => unmarshall(i)).map((i) => ({
    orderId: i.orderId as string,
    userId: i.userId as string,
    status: i.status as Order["status"],
    stripePaymentIntentId: i.stripePaymentIntentId as string | undefined,
    stripeCheckoutSessionId: i.stripeCheckoutSessionId as string | undefined,
    createdAt: i.createdAt as number,
    confirmedAt: i.confirmedAt as number | undefined,
    cancelledAt: i.cancelledAt as number | undefined,
    refundId: i.refundId as string | undefined,
    expiresAt: i.expiresAt as number | undefined,
  }));
}

export async function listAllOrders({
  dynamoClient,
  status,
  limit,
}: {
  dynamoClient: DynamoDBClient;
  status?: Order["status"];
  limit?: number;
}): Promise<Order[]> {
  const scanParams: ScanInput = {
    TableName: genericConfig.StoreCartsOrdersTableName,
    FilterExpression: "lineItemId = :orderMarker",
    ExpressionAttributeValues: marshall({
      ":orderMarker": "ORDER",
    }),
    Limit: limit,
  };

  if (status) {
    scanParams.FilterExpression += " AND #status = :status";
    scanParams.ExpressionAttributeNames = { "#status": "status" };
    scanParams.ExpressionAttributeValues = marshall({
      ":orderMarker": "ORDER",
      ":status": status,
    });
  }

  const response = await dynamoClient.send(new ScanCommand(scanParams));

  if (!response.Items) {
    return [];
  }

  return response.Items.map((i) => unmarshall(i)).map((i) => ({
    orderId: i.orderId as string,
    userId: i.userId as string,
    status: i.status as Order["status"],
    stripePaymentIntentId: i.stripePaymentIntentId as string | undefined,
    stripeCheckoutSessionId: i.stripeCheckoutSessionId as string | undefined,
    createdAt: i.createdAt as number,
    confirmedAt: i.confirmedAt as number | undefined,
    cancelledAt: i.cancelledAt as number | undefined,
    refundId: i.refundId as string | undefined,
    expiresAt: i.expiresAt as number | undefined,
  }));
}

export type CreateProductInputs = {
  productData: CreateProductRequest;
  dynamoClient: DynamoDBClient;
  stripeApiKey: string;
  logger: ValidLoggers;
};

export async function createProduct({
  productData,
  dynamoClient,
  stripeApiKey,
  logger,
}: CreateProductInputs): Promise<void> {
  const stripeClient = new Stripe(stripeApiKey);
  const { variants, ...productMeta } = productData;
  const now = Math.floor(Date.now() / 1000);

  if (variants.length > 24) {
    throw new ValidationError({
      message: "Too many variants. DynamoDB transaction limit is 25 items.",
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
  // We map the incoming request variants to the DB structure including the new Stripe IDs
  const dbVariants = [];

  try {
    for (const variant of variants) {
      // Create Member Price
      const variantId = randomUUID();
      const memberPrice = await stripeClient.prices.create({
        product: stripeProduct.id,
        currency: "usd",
        unit_amount: variant.memberPriceCents,
        metadata: {
          variantId,
          type: "member",
        },
      });

      // Create Non-Member Price
      const nonMemberPrice = await stripeClient.prices.create({
        product: stripeProduct.id,
        currency: "usd",
        unit_amount: variant.nonmemberPriceCents,
        metadata: {
          variantId,
          type: "non_member",
        },
      });

      dbVariants.push({
        ...variant, // name, description, limits, etc.
        variantId,
        productId: productMeta.productId,
        memberPriceId: memberPrice.id,
        nonmemberPriceId: nonMemberPrice.id,
        soldCount: 0,
      });
    }
  } catch (err) {
    logger.error(
      { err, stripeProductId: stripeProduct.id },
      "Failed to create Stripe prices",
    );
    // Optional: Attempt to clean up the orphaned Stripe product here if desired
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
            // remove the raw cents fields before saving to DB if you want to keep it clean,
            // or keep them for reference. The schema expects *PriceId, so we are good.
            createdAt: now,
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
}
