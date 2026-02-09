import * as z from "zod/v4";

export const invoiceLinkPostResponseSchema = z.object({
  id: z.string().min(1).meta({
    description: "The Payment Link's ID in the Stripe API",
  }),
  link: z.url().meta({
    description: "The Payment Link URL",
  })
})

const invoiceId = z.string().min(1).meta({ description: "Invoice identifier. Should be prefixed with an organization identifier to allow for easy processing." });
const invoiceAmountUsd = z.number().min(50).meta({ description: "Billed amount, in cents." });

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
