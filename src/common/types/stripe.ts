import * as z from "zod/v4";
// Nonnegative safe-integer amount in the smallest currency unit (cents for USD).
const cents = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .meta({ description: "A nonnegative amount in cents (USD)." });

const rampUuid = z.uuid().meta({ description: "A Ramp resource UUID." });

/**
 * Minimal projection of a Ramp fund for selection/settlement: its stable id
 * and current display name. The routing record keeps the full immutable
 * RampTarget; this DTO is only the saved presentation projection.
 */
export const rampFundSchema = z.object({
  id: rampUuid,
  displayName: z.string().min(1),
});
export type RampFund = z.infer<typeof rampFundSchema>;

export const rampFundsResponseSchema = z.object({
  status: z.enum(["connected", "not_linked", "unavailable"]).meta({
    description:
      "connected: an eligible Ramp identity with (possibly zero) funds; " +
      "not_linked: no matching active Ramp user; unavailable: provider/config failure.",
  }),
  funds: z.array(rampFundSchema),
});
export type RampFundsResponse = z.infer<typeof rampFundsResponseSchema>;

/**
 * Immutable Ramp target provenance, derived server-side and stored in the
 * routing record. It is provenance only, never a local permission grant.
 */
export const rampTargetSchema = z.object({
  namespace: z.enum(["sandbox", "production"]),
  businessId: rampUuid,
  fundId: rampUuid,
  fundName: z.string().min(1),
  rampUserId: rampUuid,
  creatorTenantId: rampUuid,
  creatorObjectId: rampUuid,
});
export type RampTarget = z.infer<typeof rampTargetSchema>;

/**
 * Actual verified Stripe net proceeds for one successful payment. Fee/net are
 * only ever present together with a resolved balance transaction; they are
 * never estimated, and gross - fee must equal net.
 */
export const proceedsSchema = z
  .object({
    grossCents: cents,
    feeCents: cents,
    netCents: cents,
    chargeId: z.string().min(1),
    balanceTransactionId: z.string().min(1),
  })
  .refine((p) => p.grossCents - p.feeCents === p.netCents, {
    message: "grossCents - feeCents must equal netCents",
  });
export type Proceeds = z.infer<typeof proceedsSchema>;

const unavailableReasonSchema = z.enum([
  "fees_unavailable",
  "provider_unavailable",
  "fund_paused",
  "fund_busy",
  "invalid_proceeds",
  "coordination_window_expired",
]);

/**
 * Exhaustive credit outcome for one payment. `unavailable` carries gross plus a
 * reason; fee/net (via `proceeds`) only when established, and must agree with
 * the top-level gross. A positive credit's attempted delta must equal its net.
 */
export const rampCreditOutcomeSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("credited"),
      proceeds: proceedsSchema,
      previousLimitCents: cents,
      newLimitCents: cents,
    })
    .refine(
      (o) => o.newLimitCents - o.previousLimitCents === o.proceeds.netCents,
      {
        message: "credited limit delta must equal net proceeds",
      },
    ),
  z.object({ status: z.literal("fund_missing"), proceeds: proceedsSchema }),
  z.object({ status: z.literal("access_revoked"), proceeds: proceedsSchema }),
  z.object({ status: z.literal("fund_ineligible"), proceeds: proceedsSchema }),
  z
    .object({
      status: z.literal("unavailable"),
      grossCents: cents,
      reason: unavailableReasonSchema,
      proceeds: z.optional(proceedsSchema),
    })
    .refine(
      (o) => o.proceeds === undefined || o.grossCents === o.proceeds.grossCents,
      {
        message: "unavailable grossCents must match proceeds.grossCents",
      },
    ),
  z
    .object({
      status: z.literal("unconfirmed"),
      proceeds: proceedsSchema,
      previousLimitCents: cents,
      newLimitCents: cents,
    })
    .refine(
      (o) => o.newLimitCents - o.previousLimitCents === o.proceeds.netCents,
      {
        message: "unconfirmed limit delta must equal net proceeds",
      },
    ),
]);
export type RampCreditOutcome = z.infer<typeof rampCreditOutcomeSchema>;

// ---- Provider response schemas (only fields actually consumed) ----

export const rampTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});
export type RampTokenResponse = z.infer<typeof rampTokenResponseSchema>;

export const rampBusinessSchema = z.object({
  id: z.uuid(),
});
export type RampBusiness = z.infer<typeof rampBusinessSchema>;

export const rampUserStatusSchema = z.enum([
  "INVITE_EXPIRED",
  "INVITE_PENDING",
  "USER_ACTIVE",
  "USER_DRAFT",
  "USER_INACTIVE",
  "USER_ONBOARDING",
  "USER_SUSPENDED",
]);
export type RampUserStatus = z.infer<typeof rampUserStatusSchema>;

export const rampUserRoleSchema = z.enum([
  "AUDITOR",
  "BUSINESS_ADMIN",
  "BUSINESS_BOOKKEEPER",
  "BUSINESS_OWNER",
  "BUSINESS_USER",
  "GUEST_USER",
  "IT_ADMIN",
  "UNBUNDLED_ADMIN",
  "UNBUNDLED_BOOKKEEPER",
  "UNBUNDLED_OWNER",
  "UNBUNDLED_USER",
]);
export type RampUserRole = z.infer<typeof rampUserRoleSchema>;

export const rampUserSchema = z.object({
  id: z.uuid(),
  email: z.string().min(1),
  status: rampUserStatusSchema,
  role: rampUserRoleSchema,
  business_id: z.uuid().nullable(),
});
export type RampUser = z.infer<typeof rampUserSchema>;

export const rampCurrencyAmountSchema = z.object({
  amount: z.number().int(),
  currency_code: z.string().min(1),
});
export type RampCurrencyAmount = z.infer<typeof rampCurrencyAmountSchema>;

export const rampFundStateSchema = z.enum([
  "ACTIVE",
  "ARCHIVED",
  "SUSPENDED",
  "TERMINATED",
]);
export type RampFundState = z.infer<typeof rampFundStateSchema>;

export const rampIntervalSchema = z.enum([
  "ANNUAL",
  "DAILY",
  "MONTHLY",
  "QUARTERLY",
  "TERTIARY",
  "TOTAL",
  "WEEKLY",
  "YEARLY",
]);
export type RampInterval = z.infer<typeof rampIntervalSchema>;

export const rampFundSuspensionSchema = z.object({
  suspended_at: z.iso.datetime().nullable(),
  suspended_by_ramp: z.boolean(),
  suspended_by_user_id: z.uuid().nullable(),
});
export type RampFundSuspension = z.infer<typeof rampFundSuspensionSchema>;

export const rampFundMemberSchema = z.object({
  user_id: z.uuid(),
  suspension: rampFundSuspensionSchema.nullable(),
});
export type RampFundMember = z.infer<typeof rampFundMemberSchema>;

export const rampFundResourceSchema = z.object({
  id: z.uuid(),
  display_name: z.string().min(1),
  state: rampFundStateSchema,
  spending_restrictions: z
    .object({
      interval: rampIntervalSchema,
      limit: rampCurrencyAmountSchema.nullable(),
      temporary_limit: rampCurrencyAmountSchema.nullable(),
    })
    .nullable(),
  members: z.array(rampFundMemberSchema),
});
export type RampFundResource = z.infer<typeof rampFundResourceSchema>;

export const rampErrorResponseSchema = z.object({
  error_v2: z.object({
    error_code: z.string().min(1).max(255),
    message: z.string().min(1),
  }),
});

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
  rampFundId: z.optional(z.uuid()).meta({
    description:
      "Optional Ramp fund UUID; net proceeds increase that fund's non-repeating spending limit. Absence remains an ordinary link.",
  }),
});

export type PostInvoiceLinkRequest = z.infer<
  typeof invoiceLinkPostRequestSchema
>;

export type PostInvoiceLinkResponse = z.infer<
  typeof invoiceLinkPostResponseSchema
>;

export const invoiceLinkGetResponseSchema = z.array(
  invoiceLinkPostRequestSchema.omit({ rampFundId: true }).extend({
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
    rampFund: z.optional(rampFundSchema).meta({
      description:
        "Saved Ramp fund projection for a targeted link; absent for ordinary links.",
    }),
  }),
);

export type GetInvoiceLinksResponse = z.infer<
  typeof invoiceLinkGetResponseSchema
>;
