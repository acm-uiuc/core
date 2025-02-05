import { z } from 'zod';

export const invoiceLinkPostResponseSchema = z.object({
  invoiceId: z.string().min(1),
  link: z.string().url(),
})

export const invoiceLinkPostRequestSchema = z.object({
  invoiceId: z.string().min(1),
  invoiceAmountUsd: z.number().min(50),
  contactName: z.string().min(1),
  contactEmail: z.string().email()
})
