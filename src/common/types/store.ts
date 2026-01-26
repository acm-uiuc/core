import * as z from "zod/v4";

// ============ Constants ============
export const DEFAULT_VARIANT_ID = "DEFAULT";

// ============ Enums ============
export const orderStatusEnum = z.enum([
  "PENDING",    // Cart created, payment not yet confirmed
  "CAPTURING",  // Waiting to capture payment
  "ACTIVE",     // Payment confirmed, order is active
  "REFUNDED",   // Order has been fully refunded
  "CANCELLED",  // Order was cancelled (payment voided or failed)
]);

export type OrderStatus = z.infer<typeof orderStatusEnum>;

export const limitTypeEnum = z.enum(["PER_PRODUCT", "PER_VARIANT"]);
export type LimitType = z.infer<typeof limitTypeEnum>;

// ============ Limit Configuration ============
export const limitConfigurationSchema = z.object({
  limitType: limitTypeEnum,
  maxQuantity: z.number().int().positive(),
});

export type LimitConfiguration = z.infer<typeof limitConfigurationSchema>;

// ============ Variant Schema (DynamoDB item) ============
export const variantSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
  memberLists: z.array(z.string()).optional(), // Lists user must be in for member pricing
  memberPriceId: z.string().min(1), // Stripe price ID for members
  nonmemberPriceId: z.string().min(1), // Stripe price ID for non-members
  inventoryCount: z.number().int().min(0).nullable().optional(), // null = unlimited
  soldCount: z.number().int().min(0).default(0),
  exchangesAllowed: z.boolean().default(true),
});

export type Variant = z.infer<typeof variantSchema>;

// ============ Product Schema (DEFAULT variant + metadata) ============
export const productSchema = z.object({
  productId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  imageUrl: z.url().optional(),
  openAt: z.number().int().optional(), // Unix timestamp when sales open
  closeAt: z.number().int().optional(), // Unix timestamp when sales close
  stripeProductId: z.string().optional(), // Stripe product ID
  limitConfiguration: limitConfigurationSchema.optional(),
  verifiedIdentityRequired: z.boolean().default(true)
});

export type Product = z.infer<typeof productSchema>;

// ============ Product with Variants (for API responses) ============
export const productWithVariantsSchema = productSchema.extend({
  variants: z.array(variantSchema.omit({ productId: true })),
});

export const productWithVariantsPublicCountSchema = productSchema.extend({
  variants: z.array(variantSchema.omit({ productId: true, soldCount: true, memberPriceId: true, nonmemberPriceId: true })),
}).omit({ stripeProductId: true });

export type ProductWithVariants = z.infer<typeof productWithVariantsSchema>;

// ============ Line Item Schema (DynamoDB item) ============
export const lineItemSchema = z.object({
  orderId: z.string().min(1),
  lineItemId: z.string().min(1),
  productId: z.string().min(1),
  variantId: z.string().min(1),
  quantity: z.number().int().positive(),
  priceId: z.string().min(1), // Stripe price ID used
  unitPriceCents: z.number().int().min(0).optional(),
  createdAt: z.number().int(),
  itemId: z.string().optional(), // For GSI: `${productId}#${variantId}`
});

export type LineItem = z.infer<typeof lineItemSchema>;

// ============ Order Schema (DynamoDB item metadata) ============
export const orderSchema = z.object({
  orderId: z.string().min(1),
  userId: z.string().email(), // User's email
  status: orderStatusEnum,
  stripePaymentIntentId: z.string().optional(),
  createdAt: z.number().int(),
  confirmedAt: z.number().int().optional(),
  cancelledAt: z.number().int().optional(),
  refundId: z.string().optional(),
  expiresAt: z.number().int().optional(),
});

export type Order = z.infer<typeof orderSchema>;

// ============ Order with Line Items (for API responses) ============
export const orderWithLineItemsSchema = orderSchema.extend({
  lineItems: z.array(lineItemSchema),
});

export type OrderWithLineItems = z.infer<typeof orderWithLineItemsSchema>;

// ============ API Request Schemas ============

// Create Checkout Request
export const createCheckoutRequestSchema = z.object({
  items: z.array(z.object({
    productId: z.string().min(1),
    variantId: z.string().min(1),
    quantity: z.number().int().positive().max(10),
  })).min(1).max(20), // Max 20 items, max 10 of each
  successRedirPath: z.string().startsWith('/').max(512),
  cancelRedirPath: z.string().startsWith('/').max(512),
  email: z.email().optional()
});

export type CreateCheckoutRequest = z.infer<typeof createCheckoutRequestSchema>;

// ============ API Response Schemas ============

// Create Checkout Response
export const createCheckoutResponseSchema = z.object({
  checkoutUrl: z.string().url(),
  orderId: z.string().min(1),
  expiresAt: z.number().int(),
});

export type CreateCheckoutResponse = z.infer<typeof createCheckoutResponseSchema>;

// List Products Response
export const listProductsResponseSchema = z.object({
  products: z.array(productWithVariantsSchema),
});
export const listProductsPublicResponseSchema = z.object({
  products: z.array(productWithVariantsPublicCountSchema),
});

export type ListProductsResponse = z.infer<typeof listProductsResponseSchema>;

// Get Product Response
export const getProductResponseSchema = productWithVariantsSchema;

export type GetProductResponse = z.infer<typeof getProductResponseSchema>;

// List Orders Response
export const listOrdersResponseSchema = z.object({
  orders: z.array(orderSchema),
});

export type ListOrdersResponse = z.infer<typeof listOrdersResponseSchema>;

// Get Order Response
export const getOrderResponseSchema = orderWithLineItemsSchema;

export type GetOrderResponse = z.infer<typeof getOrderResponseSchema>;

// ============ Webhook Metadata Schema ============
export const storeWebhookMetadataSchema = z.object({
  initiator: z.literal("acm-store"),
  orderId: z.string().min(1),
  userId: z.string().email(),
});

export type StoreWebhookMetadata = z.infer<typeof storeWebhookMetadataSchema>;

// ============ Sellability Check Result ============
export const sellabilityResultSchema = z.object({
  priceId: z.string().min(1),
  unitPriceCents: z.number().int().min(0),
  isMemberPrice: z.boolean(),
});

export type SellabilityResult = z.infer<typeof sellabilityResultSchema>;

export const createVariantRequestSchema = variantSchema
  .omit({
    productId: true,
    variantId: true,
    memberPriceId: true,
    nonmemberPriceId: true,
    soldCount: true
  })
  .extend({
    memberPriceCents: z.number().int().min(0),
    nonmemberPriceCents: z.number().int().min(0),
  });

// 2. Product Request (User provides metadata + variants)
export const createProductRequestSchema = productSchema
  .omit({
    stripeProductId: true, // We will generate this
  })
  .extend({
    variants: z.array(createVariantRequestSchema).min(1),
  });

export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;
