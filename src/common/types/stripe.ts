import * as z from "zod/v4";

const id = z.string().min(1).meta({
  description: "The Payment Link's ID in the Stripe API",
});
const link = z.url().meta({
  description: "The Payment Link URL",
});
const invoiceId = z.string().min(1).meta({
  description:
    "Invoice identifier. Should be prefixed with an organization identifier to allow for easy processing.",
});
const invoiceAmountUsd = z
  .number()
  .min(50)
  .meta({ description: "Billed amount, in cents." });

const callbackUrl = z
  .url()
  .refine((u) => u.startsWith("https://"), {
    message: "callbackUrl must use https://",
  })
  .meta({
    description:
      "HTTPS URL that will receive signed POST callbacks when payment events occur on this link.",
  });
const signingSecret = z.string().min(1).meta({
  description:
    "Per-link HMAC-SHA256 signing secret. Returned once at creation; store it to verify incoming callbacks.",
});
const callbackOrigin = z.string().min(1).meta({
  description:
    "Scheme, host and port of a registered callback destination, e.g. https://abc123.lambda-url.us-east-2.on.aws",
  example: "https://abc123.lambda-url.us-east-2.on.aws",
});

export const callbackRegistrationPostRequestSchema = z.object({
  callbackUrl: z.url().meta({
    description:
      "Any HTTPS URL on the destination to register. Only its origin is stored: registering https://example.com/a permits callbacks to any path on https://example.com.",
    example: "https://abc123.lambda-url.us-east-2.on.aws/dosomething",
  }),
  description: z.string().min(1).max(256).meta({
    description: "What this destination is, for whoever reads the list later.",
    example: "Vending machine vend trigger (prod)",
  }),
});

export const callbackRegistrationSchema = z.object({
  origin: callbackOrigin,
  description: z.string(),
  createdBy: z.string().meta({
    description: "User who registered this origin.",
  }),
  createdAt: z.union([z.iso.datetime(), z.null()]).meta({
    description: "When the origin was registered.",
  }),
});

export const callbackRegistrationGetResponseSchema = z.array(
  callbackRegistrationSchema,
);

export type CallbackRegistration = z.infer<typeof callbackRegistrationSchema>;

export const invoiceLinkPostResponseSchema = z.object({
  id,
  link,
  signingSecret: z.optional(signingSecret),
});
export const invoiceLinkPostRequestSchema = z.object({
  invoiceId,
  invoiceAmountUsd,
  contactName: z.string().min(1).meta({
    description: "Name of whomever the payment link is intended for.",
  }),
  contactEmail: z.email().meta({
    description: "Email of whomever the payment link is intended for.",
  }),
  achPaymentsEnabled: z.optional(z.boolean()).default(false).meta({
    description:
      "True if delayed settlement ACH push payments are enabled for this invoice.",
  }),
  callbackUrl: z.optional(callbackUrl),
});

export type PostInvoiceLinkRequest = z.infer<
  typeof invoiceLinkPostRequestSchema
>;

export type PostInvoiceLinkResponse = z.infer<
  typeof invoiceLinkPostResponseSchema
>;

export const invoiceLinkGetResponseSchema = z.array(
  invoiceLinkPostRequestSchema.extend({
    id,
    link,
    userId: z.email().meta({
      description: "The user ID of the user that created the payment link",
    }),
    active: z.boolean().meta({
      description:
        "True if the payment link is active and able to accept payments, false otherwise.",
    }),
    invoiceId,
    invoiceAmountUsd,
    createdAt: z
      .union([z.iso.datetime(), z.null()])
      .meta({ description: "When the payment link was created." }),
  }),
);

export type GetInvoiceLinksResponse = z.infer<
  typeof invoiceLinkGetResponseSchema
>;
