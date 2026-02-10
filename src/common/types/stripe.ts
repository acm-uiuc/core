import * as z from "zod/v4";


const id = z.string().min(1).meta({
  description: "The Payment Link's ID in the Stripe API",
})
const link = z.url().meta({
  description: "The Payment Link URL",
})
const invoiceId = z.string().min(1).meta({ description: "Invoice identifier. Should be prefixed with an organization identifier to allow for easy processing." });
const invoiceAmountUsd = z.number().min(50).meta({ description: "Billed amount, in cents." });

export const invoiceLinkPostResponseSchema = z.object({
  id,
  link
})
export const invoiceLinkPostRequestSchema = z.object({
  invoiceId,
  invoiceAmountUsd,
  contactName: z.string().min(1).meta({ description: "Name of whomever the payment link is intended for." }),
  contactEmail: z.email().meta({ description: "Email of whomever the payment link is intended for." }),
  achPaymentsEnabled: z.optional(z.boolean()).default(false).meta({ description: "True if delayed settlement ACH push payments are enabled for this invoice." }),
});

export type PostInvoiceLinkRequest = z.infer<
  typeof invoiceLinkPostRequestSchema>;


export type PostInvoiceLinkResponse = z.infer<
  typeof invoiceLinkPostResponseSchema>;


export const invoiceLinkGetResponseSchema = z.array(
  invoiceLinkPostRequestSchema.extend({
    id,
    link,
    userId: z.email().meta({
      description: 'The user ID of the user that created the payment link'
    }),
    active: z.boolean().meta({
      description: "True if the payment link is active and able to accept payments, false otherwise."
    }),
    invoiceId,
    invoiceAmountUsd,
    createdAt: z.union([z.iso.datetime(), z.null()]).meta({ description: "When the payment link was created." })
  })
);

export type GetInvoiceLinksResponse = z.infer<
  typeof invoiceLinkGetResponseSchema>;

export const createInvoicePostResponseSchema = z.object({
  id: z.string().min(1),
  link: z.url(),
});

export const createInvoiceConflictResponseSchema = z.object({
  needsConfirmation: z.literal(true),
  customerId: z.string().min(1),
  current: z.object({
    name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
  }),
  incoming: z.object({
    name: z.string().min(1),
    email: z.string().email(),
  }),
  message: z.string().min(1),
});

export const createInvoicePostResponseSchemaUnion = z.union([
  createInvoicePostResponseSchema,     // success: 201
  createInvoiceConflictResponseSchema, // info mismatch: 409
]);

export type PostCreateInvoiceResponseUnion = z.infer<
  typeof createInvoicePostResponseSchemaUnion
>;

export const createInvoicePostRequestSchema = z.object({
  invoiceId,          // reuse your meta’d primitive from file 2
  invoiceAmountUsd,   // reuse your meta’d primitive from file 2
  contactName: z.string().min(1), // or swap to your meta version if you want
  contactEmail: z.email(),        // or swap to your meta version if you want
  acmOrg: z.string().min(1),
});

export type PostCreateInvoiceRequest = z.infer<
  typeof createInvoicePostRequestSchema
>;

export type PostCreateInvoiceResponse = z.infer<
  typeof createInvoicePostResponseSchema
>;
