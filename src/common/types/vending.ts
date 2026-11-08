import * as z from "zod/v4";

const unixTimestampSchema = z.number().int().nonnegative();

// This table is updated only by the vending machine RPI
export const vendingInventorySchema = z.object({
  slotId: z.string().min(1),
  itemName: z.string().min(1),
  price: z.number().int().nonnegative(),
  stripePriceId: z.string().startsWith("price_").min(7),
  quantity: z.number().int().nonnegative(),
});

export type VendingInventory = z.infer<typeof vendingInventorySchema>;

export const vendingTransactionStatusSchema = z.enum([
  "pending_payment",
  "authorized",
  "dispensed",
  "canceled",
]);

export type VendingTransactionStatus = z.infer<
  typeof vendingTransactionStatusSchema
>;

export const vendingPaymentStatusSchema = z.enum([
  "pending",
  "authorized",
  "captured",
  "canceled",
]);

// This table is updated only by core
export const vendingTransactionSchema = z.object({
  vendId: z.uuid(),
  slotId: z.string().min(1).meta({
    description: "Inventory slotId selected for this vend, for example A#4.",
  }),
  priceCents: z.number().int().nonnegative(),
  itemName: z.string(),
  checkoutSessionId: z.string().min(1),
  paymentIntentId: z.string().min(1).nullable().default(null),
  status: vendingTransactionStatusSchema,
  paymentStatus: vendingPaymentStatusSchema,
  createdAt: unixTimestampSchema,
  expiresAt: unixTimestampSchema.optional(),
  dispensedAt: unixTimestampSchema.nullish(),
  failedAt: unixTimestampSchema.nullish(),
  authorizedAt: unixTimestampSchema.optional(),
  capturedAt: unixTimestampSchema.optional(),
  canceledAt: unixTimestampSchema.optional(),
});

export type VendingTransaction = z.infer<typeof vendingTransactionSchema>;
