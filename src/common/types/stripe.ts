import * as z from "zod/v4";

export const invoiceLinkPostResponseSchema = z.object({
  id: z.string().min(1),
  link: z.string().url()
});

export const invoiceLinkPostRequestSchema = z.object({
  invoiceId: z.string().min(1),
  invoiceAmountUsd: z.number().min(50),
  contactName: z.string().min(1),
  contactEmail: z.string().email(),
  achPaymentsEnabled: z.boolean(),
});

export type PostInvoiceLinkRequest = z.infer<
  typeof invoiceLinkPostRequestSchema>;


export type PostInvoiceLinkResponse = z.infer<
  typeof invoiceLinkPostResponseSchema>;


export const invoiceLinkGetResponseSchema = z.array(
  z.object({
    id: z.string().min(1),
    userId: z.string().email(),
    link: z.string().url(),
    active: z.boolean(),
    invoiceId: z.string().min(1),
    invoiceAmountUsd: z.number().min(50),
    createdAt: z.union([z.string().datetime(), z.null()])
  })
);

export type GetInvoiceLinksResponse = z.infer<
  typeof invoiceLinkGetResponseSchema>;
