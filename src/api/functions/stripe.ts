import { ValidLoggers } from "api/types.js";
import { isProd, isConditionalCheckFailed } from "api/utils.js";
import { InternalServerError, ValidationError } from "common/errors/index.js";
import { MaxLengthString } from "common/types/generic.js";
import { capitalizeFirstLetter } from "common/types/roomRequest.js";
import { Proceeds } from "common/types/stripe.js";
import {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { ConfigType, genericConfig } from "common/config.js";
import { STRIPE_LINK_RETENTION_DAYS } from "common/constants.js";
import {
  AvailableSQSFunctions,
  SQSPayload,
  StripeLinkCallbackEventType,
} from "common/types/sqsMessage.js";
import { getAllUserEmails } from "common/utils.js";
import { Modules } from "common/modules.js";
import { buildAuditLogTransactPut } from "./auditLog.js";
import { getItemFromCache, insertItemIntoCache } from "./cache.js";
import { createHash } from "crypto";
import Stripe from "stripe";

const STRIPE_ACCOUNT_IDENTITY_CACHE_MS = 24 * 60 * 60 * 1000;

/**
 * A Stripe remote call must finish before the shared remote deadline. When no
 * deadline is supplied, keep the existing unbounded default (used by ordinary
 * link creation and legacy callers).
 */
export const stripeRequestOptions = (
  deadline?: number,
): Stripe.RequestOptions => {
  if (deadline === undefined) {
    return { maxNetworkRetries: 0 };
  }
  const timeout = deadline - Date.now();
  if (timeout <= 0) {
    throw new Error("Stripe remote deadline exhausted.");
  }
  return { timeout, maxNetworkRetries: 0 };
};
export function awsOptions(deadline?: number) {
  if (deadline === undefined) {
    return {};
  }
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new Error("Stripe settlement local deadline exhausted.");
  }
  return { abortSignal: AbortSignal.timeout(remaining) };
}

type CheckoutSessionCreateParams = NonNullable<
  Parameters<InstanceType<typeof Stripe>["checkout"]["sessions"]["create"]>[0]
>;
type CheckoutPaymentMethodType = NonNullable<
  CheckoutSessionCreateParams["payment_method_types"]
>[number];
type CheckoutCustomField = NonNullable<
  CheckoutSessionCreateParams["custom_fields"]
>[number];
type CheckoutCustomText = NonNullable<
  CheckoutSessionCreateParams["custom_text"]
>;

export type SupportedPaymentMethods =
  | NonNullable<Stripe.PaymentMethodCreateParams["type"]>
  | "card_present";

export const instantSettlementMethods = [
  "card",
  "crypto",
  "link",
] satisfies CheckoutPaymentMethodType[];
export const delayedSettlementMethods = [
  "us_bank_account",
] satisfies CheckoutPaymentMethodType[];

export const allPaymentMethods = [
  ...instantSettlementMethods,
  ...delayedSettlementMethods,
];

export type StripeLinkCreateParams = {
  invoiceId: string;
  invoiceAmountUsd: number;
  contactName: string;
  contactEmail: string;
  createdBy: string;
  stripeApiKey: string;
  statementDescriptorSuffix: MaxLengthString<7>;
  delayedSettlementAllowed: boolean;
  stripeClient?: Stripe;
  deadline?: number;
};

export type StripeCheckoutSessionCreateParams = {
  successUrl?: string;
  returnUrl?: string;
  customerEmail?: string;
  stripeApiKey: string;
  items: { price: string; quantity: number }[];
  initiator: string;
  metadata?: Record<string, string>;
  allowPromotionCodes: boolean;
  customFields?: CheckoutCustomField[];
  captureMethod?: "automatic" | "manual"; // manual = pre-auth only
  customText?: CheckoutCustomText;
  statementDescriptorSuffix: MaxLengthString<7>;
  delayedSettlementAllowed: boolean;
  expiresInSec?: number;
};

export type StripeCheckoutSessionCreateWithCustomerParams =
  StripeCheckoutSessionCreateParams & { customerId: string };

/**
 * Create a Stripe payment link for an invoice. Note that invoiceAmountUsd MUST IN CENTS!!
 * @param {StripeLinkCreateParams} options
 * @returns {string} A stripe link that can be used to pay the invoice
 */
export const createStripeLink = async ({
  invoiceId,
  invoiceAmountUsd,
  contactName,
  contactEmail,
  createdBy,
  stripeApiKey,
  statementDescriptorSuffix,
  delayedSettlementAllowed,
  stripeClient,
  deadline,
}: StripeLinkCreateParams): Promise<{
  linkId: string;
  priceId: string;
  productId: string;
  url: string;
}> => {
  const stripe = stripeClient || new Stripe(stripeApiKey);
  const description = `Created for ${contactName} (${contactEmail}) by ${createdBy}.`;
  const product = await stripe.products.create(
    {
      name: `Payment for Invoice: ${invoiceId}`,
      description,
    },
    stripeRequestOptions(deadline),
  );
  const price = await stripe.prices.create(
    {
      currency: "usd",
      unit_amount: invoiceAmountUsd,
      product: product.id,
    },
    stripeRequestOptions(deadline),
  );
  const paymentLink = await stripe.paymentLinks.create(
    {
      line_items: [
        {
          price: price.id,
          quantity: 1,
        },
      ],
      payment_method_types: (delayedSettlementAllowed
        ? allPaymentMethods
        : instantSettlementMethods
      ).filter(
        (x) => x !== "crypto",
      ) as Stripe.PaymentLinkCreateParams["payment_method_types"],
      // Payment links don't support crypto

      payment_intent_data: {
        statement_descriptor_suffix: statementDescriptorSuffix,
      },
    },
    stripeRequestOptions(deadline),
  );
  return {
    url: paymentLink.url,
    linkId: paymentLink.id,
    productId: product.id,
    priceId: price.id,
  };
};

export const createCheckoutSession = async ({
  successUrl,
  returnUrl,
  stripeApiKey,
  customerEmail,
  items,
  initiator,
  allowPromotionCodes,
  customFields,
  metadata,
  captureMethod,
  customText,
  statementDescriptorSuffix,
  expiresInSec,
}: StripeCheckoutSessionCreateParams): Promise<string> => {
  const stripe = new Stripe(stripeApiKey);
  const payload: CheckoutSessionCreateParams = {
    success_url: successUrl || "",
    cancel_url: returnUrl || "",
    payment_method_types:
      captureMethod === "manual"
        ? instantSettlementMethods.filter((x) => x !== "crypto")
        : instantSettlementMethods,
    line_items: items.map((item) => ({
      price: item.price,
      quantity: item.quantity,
    })),
    mode: "payment",
    customer_email: customerEmail,
    metadata: {
      ...(metadata || {}),
      initiator,
    },
    allow_promotion_codes: allowPromotionCodes,
    custom_text: customText,
    custom_fields: customFields,
    ...(expiresInSec && {
      expires_at: Math.ceil(Date.now() / 1000) + expiresInSec + 5,
    }), // grant 5 second grace period in expiry
    payment_intent_data: {
      ...(captureMethod && { capture_method: captureMethod }),
      statement_descriptor_suffix: statementDescriptorSuffix,
    },
  };
  const session = await stripe.checkout.sessions.create(payload);
  if (!session.url) {
    throw new InternalServerError({
      message: "Could not create Stripe checkout session.",
    });
  }
  return session.url;
};

export const createCheckoutSessionWithCustomer = async ({
  successUrl,
  returnUrl,
  stripeApiKey,
  customerId,
  items,
  initiator,
  allowPromotionCodes,
  customFields,
  metadata,
  captureMethod,
  customText,
  statementDescriptorSuffix,
  expiresInSec,
}: StripeCheckoutSessionCreateWithCustomerParams): Promise<string> => {
  const stripe = new Stripe(stripeApiKey);
  const payload: CheckoutSessionCreateParams = {
    success_url: successUrl || "",
    cancel_url: returnUrl || "",
    payment_method_types:
      captureMethod === "manual"
        ? instantSettlementMethods.filter((x) => x !== "crypto")
        : instantSettlementMethods,
    line_items: items.map((item) => ({
      price: item.price,
      quantity: item.quantity,
    })),
    mode: "payment",
    customer: customerId,
    metadata: {
      ...(metadata || {}),
      initiator,
    },
    ...(expiresInSec && {
      expires_at: Math.ceil(Date.now() / 1000) + expiresInSec + 5,
    }), // grant 5 second grace period in expiry
    allow_promotion_codes: allowPromotionCodes,
    custom_text: customText,
    custom_fields: customFields,
    payment_intent_data: {
      ...(captureMethod && { capture_method: captureMethod }),
      statement_descriptor_suffix: statementDescriptorSuffix,
    },
  };
  const session = await stripe.checkout.sessions.create(payload);
  if (!session.url) {
    throw new InternalServerError({
      message: "Could not create Stripe checkout session.",
    });
  }
  return session.url;
};

export const deactivateStripeLink = async ({
  linkId,
  stripeApiKey,
}: {
  linkId: string;
  stripeApiKey: string;
}): Promise<void> => {
  const stripe = new Stripe(stripeApiKey);
  await stripe.paymentLinks.update(linkId, {
    active: false,
  });
};

export const deactivateStripeProduct = async ({
  productId,
  stripeApiKey,
}: {
  productId: string;
  stripeApiKey: string;
}): Promise<void> => {
  const stripe = new Stripe(stripeApiKey);
  await stripe.products.update(productId, {
    active: false,
  });
};

export const getStripePaymentIntentData = async ({
  stripeClient,
  paymentIntentId,
  stripeApiKey,
  expand,
  requestOptions,
}: {
  paymentIntentId: string;
  stripeApiKey: string;
  stripeClient?: Stripe;
  expand?: string[];
  requestOptions?: Stripe.RequestOptions;
}) => {
  const stripe = stripeClient || new Stripe(stripeApiKey);
  return await stripe.paymentIntents.retrieve(
    paymentIntentId,
    expand ? { expand } : undefined,
    requestOptions,
  );
};

export const getPaymentMethodForPaymentIntent = async ({
  paymentIntentId,
  stripeApiKey,
  stripeClient,
  paymentIntentData,
  requestOptions,
}: {
  paymentIntentId: string;
  stripeApiKey: string;
  stripeClient?: Stripe;
  paymentIntentData?: Stripe.PaymentIntent;
  requestOptions?: Stripe.RequestOptions;
}) => {
  const stripe = stripeClient || new Stripe(stripeApiKey);
  const data =
    paymentIntentData ??
    (await getStripePaymentIntentData({
      paymentIntentId,
      stripeApiKey,
      stripeClient: stripe,
    }));
  if (!data) {
    throw new InternalServerError({
      internalLog: `Could not find payment intent data for payment intent ID "${paymentIntentId}".`,
    });
  }
  const paymentMethodId = data.payment_method?.toString();
  if (!paymentMethodId) {
    throw new InternalServerError({
      internalLog: `Could not find payment method ID for payment intent ID "${paymentIntentId}".`,
    });
  }
  const paymentMethodData = await stripe.paymentMethods.retrieve(
    paymentMethodId,
    undefined,
    requestOptions,
  );
  if (!paymentMethodData) {
    throw new InternalServerError({
      internalLog: `Could not find payment method data for payment intent ID "${paymentIntentId}".`,
    });
  }
  return paymentMethodData;
};

export const supportedStripePaymentMethods = [
  "us_bank_account",
  "card",
  "card_present",
  "crypto",
  "link",
] as const satisfies readonly SupportedPaymentMethods[];

export type SupportedStripePaymentMethod =
  (typeof supportedStripePaymentMethods)[number];
export const paymentMethodTypeToFriendlyName: Record<
  SupportedStripePaymentMethod,
  string
> = {
  us_bank_account: "ACH Direct Debit",
  card: "Credit/Debit Card",
  card_present: "Credit/Debit Card (Card Present)",
  crypto: "Cryptocurrency",
  link: "Link",
};

export const cardBrandMap: Record<string, string> = {
  amex: "American Express",
  american_express: "American Express",
  cartes_bancaires: "Cartes Bancaires",
  diners: "Diners Club",
  diners_club: "Diners Club",
  discover: "Discover",
  eftpos_au: "EFTPOS Australia",
  eftpos_australia: "EFTPOS Australia",
  interac: "Interac",
  jcb: "JCB",
  link: "Link",
  mastercard: "Mastercard",
  unionpay: "UnionPay",
  visa: "Visa",
  unknown: "Unknown Brand",
  other: "Unknown Brand",
};

export const getPaymentMethodDescriptionString = ({
  paymentMethod,
  paymentMethodType,
}: {
  paymentMethod: Stripe.PaymentMethod;
  paymentMethodType: SupportedStripePaymentMethod;
}) => {
  const friendlyName = paymentMethodTypeToFriendlyName[paymentMethodType];
  switch (paymentMethodType) {
    case "us_bank_account":
      const bankData = paymentMethod[paymentMethodType];
      if (!bankData) {
        return null;
      }
      return `${friendlyName} (${bankData.bank_name} ${capitalizeFirstLetter(bankData.account_type || "checking")} ${bankData.last4})`;
    case "card":
      const cardData = paymentMethod[paymentMethodType];
      if (!cardData) {
        return null;
      }
      return `${friendlyName} (${cardBrandMap[cardData.display_brand || "unknown"]} ending in ${cardData.last4})`;
    case "card_present":
      const cardPresentData = paymentMethod[paymentMethodType];
      if (!cardPresentData) {
        return null;
      }
      return `${friendlyName} (${cardBrandMap[cardPresentData.brand || "unknown"]} ending in ${cardPresentData.last4})`;
  }
};

export const getStripeNetProceeds = (
  intent: Stripe.PaymentIntent,
): Proceeds | null => {
  if (intent.status !== "succeeded") {
    throw new ValidationError({
      message:
        "Cannot compute net proceeds for a payment intent that has not succeeded.",
    });
  }
  if (intent.currency !== "usd") {
    throw new ValidationError({
      message: "Stripe net proceeds require a USD payment intent.",
    });
  }
  const charge = intent.latest_charge;
  if (!charge || typeof charge === "string") {
    // The expanded balance transaction is not available yet; caller retries.
    return null;
  }
  if (charge.payment_intent !== intent.id) {
    throw new ValidationError({
      message: "Stripe latest charge does not belong to the payment intent.",
    });
  }
  if (charge.status !== "succeeded" || !charge.captured) {
    throw new ValidationError({
      message: "Stripe latest charge is not a captured successful charge.",
    });
  }
  if (charge.currency !== "usd") {
    throw new ValidationError({
      message: "Stripe net proceeds require a USD charge.",
    });
  }
  const balanceTransaction = charge.balance_transaction;
  if (!balanceTransaction || typeof balanceTransaction === "string") {
    return null;
  }
  if (balanceTransaction.source !== charge.id) {
    throw new ValidationError({
      message: "Stripe balance transaction does not belong to the charge.",
    });
  }
  if (balanceTransaction.currency !== "usd") {
    throw new ValidationError({
      message: "Stripe net proceeds require a USD balance transaction.",
    });
  }
  const {
    amount: grossCents,
    fee: feeCents,
    net: netCents,
  } = balanceTransaction;
  if (
    !Number.isSafeInteger(grossCents) ||
    !Number.isSafeInteger(feeCents) ||
    !Number.isSafeInteger(netCents) ||
    grossCents < 0 ||
    feeCents < 0 ||
    netCents < 0
  ) {
    throw new ValidationError({
      message: "Stripe balance transaction has unsafe or negative amounts.",
    });
  }
  if (grossCents - feeCents !== netCents) {
    throw new ValidationError({
      message: "Stripe gross, fee and net amounts are inconsistent.",
    });
  }
  return {
    grossCents,
    feeCents,
    netCents,
    chargeId: charge.id,
    balanceTransactionId: balanceTransaction.id,
  };
};

/**
 * The Stripe account ID backing this credential, cached under a digest of the
 * credential so rotation inside the same account remains valid while a
 * different key cannot alias a stale identity. Immutable per credential; the
 * cache never stores Ramp permissions.
 */
export const getStripeAccountIdentity = async ({
  stripeClient,
  stripeApiKey,
  dynamoClient,
  deadline,
}: {
  stripeClient?: Stripe;
  stripeApiKey: string;
  dynamoClient: DynamoDBClient;
  deadline?: number;
}): Promise<string> => {
  const stripe = stripeClient || new Stripe(stripeApiKey);
  const cacheKey = `stripe_account_identity_${createHash("sha256").update(stripeApiKey).digest("hex")}`;
  const remaining = deadline === undefined ? undefined : deadline - Date.now();
  if (remaining !== undefined && remaining <= 0) {
    throw new Error("Stripe account identity deadline exhausted.");
  }
  const cacheOptions =
    remaining === undefined
      ? undefined
      : { abortSignal: AbortSignal.timeout(remaining) };
  const cached = await getItemFromCache(dynamoClient, cacheKey, cacheOptions);
  if (cached?.accountId) {
    return cached.accountId as string;
  }
  const account = await stripe.accounts.retrieveCurrent(
    undefined,
    stripeRequestOptions(deadline),
  );
  await insertItemIntoCache(
    dynamoClient,
    cacheKey,
    { accountId: account.id },
    new Date(Date.now() + STRIPE_ACCOUNT_IDENTITY_CACHE_MS),
    cacheOptions,
  );
  return account.id;
};

export type StripeCustomerCreateParams = {
  email: string;
  name: string;
  stripeApiKey: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
};

export const createStripeCustomer = async ({
  email,
  name,
  stripeApiKey,
  metadata,
  idempotencyKey,
}: StripeCustomerCreateParams): Promise<string> => {
  const stripe = new Stripe(stripeApiKey, { maxNetworkRetries: 2 });
  const customer = await stripe.customers.create(
    {
      email,
      name,
      metadata: {
        ...(metadata ?? {}),
        ...(isProd ? {} : { environment: process.env.RunEnvironment }),
      },
    },
    idempotencyKey ? { idempotencyKey } : undefined,
  );
  return customer.id;
};

/**
 * Capture a pre-authorized payment intent
 */
export const capturePaymentIntent = async ({
  paymentIntentId,
  stripeApiKey,
  idempotencyKey,
}: {
  paymentIntentId: string;
  stripeApiKey: string;
  idempotencyKey: string;
}): Promise<Stripe.PaymentIntent> => {
  const stripe = new Stripe(stripeApiKey);
  return await stripe.paymentIntents.capture(paymentIntentId, undefined, {
    idempotencyKey,
  });
};

/**
 * Cancel (void) a payment intent that has not been captured
 */
export const cancelPaymentIntent = async ({
  paymentIntentId,
  stripeApiKey,
  cancellationReason,
  idempotencyKey,
}: {
  idempotencyKey: string;
  paymentIntentId: string;
  stripeApiKey: string;
  cancellationReason?: Stripe.PaymentIntentCancelParams.CancellationReason;
}): Promise<Stripe.PaymentIntent> => {
  const stripe = new Stripe(stripeApiKey);
  return await stripe.paymentIntents.cancel(
    paymentIntentId,
    {
      cancellation_reason: cancellationReason,
    },
    { idempotencyKey },
  );
};

export const refundOrCancelPaymentIntent = async ({
  paymentIntentId,
  stripeApiKey,
  cancellationReason,
  idempotencyKey,
  logger,
}: {
  idempotencyKey: string;
  paymentIntentId: string;
  stripeApiKey: string;
  cancellationReason?: Stripe.RefundCreateParams.Reason;
  logger: ValidLoggers;
}) => {
  const stripe = new Stripe(stripeApiKey);
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (paymentIntent.status !== "succeeded") {
    logger.info("Payment intent is not succeeded, attempting to cancel.", {
      paymentIntentId,
    });
    await cancelPaymentIntent({
      paymentIntentId,
      stripeApiKey,
      cancellationReason,
      idempotencyKey: `${idempotencyKey}-cancel`,
    });
  } else {
    logger.info("Payment intent is succeeded, attempting to create refund.", {
      paymentIntentId,
    });
    try {
      await stripe.refunds.create(
        {
          payment_intent: paymentIntentId,
          reason: cancellationReason,
        },
        { idempotencyKey: `${idempotencyKey}-refund` },
      );
    } catch (e) {
      if (
        e instanceof Stripe.errors.StripeInvalidRequestError &&
        e.message.includes("You cannot refund a payment for amount=0")
      ) {
        logger.info("Payment already fully refunded, skipping.", {
          paymentIntentId,
        });
        return;
      }
      throw e;
    }
  }
};

export const shouldRetryStripeError = (error: unknown): boolean => {
  if (!(error instanceof Stripe.errors.StripeError)) {
    return false;
  }

  if (error.type === "StripeConnectionError") {
    return true;
  }

  if (error.type === "StripeRateLimitError") {
    return true;
  }

  if (error.statusCode && error.statusCode >= 500) {
    return true;
  }

  if (error.statusCode === 409) {
    return true;
  }

  return false;
};

/**
 * Send the existing owner notification email through the main queue. The
 * recipient is usually an email address (or an alias handled by
 * getAllUserEmails); a non-email userId is not deliverable and is skipped.
 */
export const notifyLinkOwner = async ({
  sqsClient,
  environmentConfig,
  requestLog,
  requestId,
  eventId,
  userId,
  subject,
  content,
  cc,
  deadline,
}: {
  sqsClient: SQSClient;
  environmentConfig: ConfigType;
  requestLog: ValidLoggers;
  requestId: string;
  eventId: string;
  userId: string;
  subject: string;
  content: string;
  cc?: string[];
  deadline?: number;
}): Promise<string | undefined> => {
  if (!userId.includes("@")) {
    return undefined;
  }
  requestLog.info(`Sending email to ${userId}...`);
  const sqsPayload: SQSPayload<AvailableSQSFunctions.EmailNotifications> = {
    function: AvailableSQSFunctions.EmailNotifications,
    metadata: { initiator: eventId, reqId: requestId },
    payload: {
      to: getAllUserEmails(userId),
      ...(cc ? { cc } : {}),
      subject,
      content,
      callToActionButton: {
        name: "View Your Stripe Links",
        url: `${environmentConfig.UserFacingUrl}/stripe`,
      },
    },
  };
  const result = await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: environmentConfig.SqsQueueUrl,
      MessageBody: JSON.stringify(sqsPayload),
      MessageGroupId: "invoiceNotification",
    }),
    awsOptions(deadline),
  );
  return result.MessageId || "";
};

/**
 * Enqueue the public subscriber callback. occurredAt is explicit for targeted
 * settlements (it records the original provider event time) and defaults to
 * now for ordinary link callbacks.
 */
export const enqueueSubscriberCallback = async ({
  sqsClient,
  environmentConfig,
  requestLog,
  requestId,
  eventId,
  eventType,
  linkId,
  callbackUrl,
  invoiceId,
  amount,
  currency,
  paidInFull,
  paymentMethod,
  payerName,
  payerEmail,
  occurredAt,
  deadline,
}: {
  sqsClient: SQSClient;
  environmentConfig: ConfigType;
  requestLog: ValidLoggers;
  requestId: string;
  eventId: string;
  eventType: StripeLinkCallbackEventType;
  linkId: string;
  callbackUrl: string | undefined;
  invoiceId: string;
  amount: number;
  currency: string;
  paidInFull: boolean;
  paymentMethod: string | null;
  payerName: string | null;
  payerEmail: string | null;
  occurredAt?: string;
  deadline?: number;
}): Promise<void> => {
  if (!callbackUrl) {
    return;
  }
  requestLog.info(
    `Enqueueing ${eventType} subscriber callback for link ${linkId}`,
  );
  const callbackPayload: SQSPayload<AvailableSQSFunctions.StripeLinkSubscriberCallback> =
    {
      function: AvailableSQSFunctions.StripeLinkSubscriberCallback,
      metadata: { initiator: eventId, reqId: requestId },
      payload: {
        linkId,
        eventType,
        eventId,
        invoiceId,
        amount,
        currency,
        paidInFull,
        paymentMethod,
        payerName,
        payerEmail,
        occurredAt: occurredAt ?? new Date().toISOString(),
      },
    };
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: environmentConfig.SqsQueueUrl,
      MessageBody: JSON.stringify(callbackPayload),
      MessageGroupId: "stripeLinkCallback",
    }),
    awsOptions(deadline),
  );
};

/**
 * Disable the presentation link and product after a full payment. The
 * conditional write is idempotent: when it fails, a strong read must prove the
 * row is already inactive (retained for presentation) before the failure is
 * treated as complete; any other failure retries.
 */
export const deactivatePaidStripeLink = async ({
  dynamoClient,
  stripeClient,
  entry,
  eventId,
  requestLog,
  deadline,
}: {
  dynamoClient: DynamoDBClient;
  stripeClient: Stripe;
  entry: {
    userId: string;
    linkId: string;
    invoiceId: string;
    productId?: string;
  };
  eventId: string;
  requestLog: ValidLoggers;
  deadline?: number;
}): Promise<void> => {
  const logStatement = buildAuditLogTransactPut({
    entry: {
      module: Modules.STRIPE,
      actor: eventId,
      target: `Link ${entry.linkId} | Invoice ${entry.invoiceId}`,
      message: "Disabled Stripe payment link as payment was made in full.",
    },
  });
  const expiresAt =
    Math.floor(Date.now() / 1000) + 86400 * STRIPE_LINK_RETENTION_DAYS;
  const dynamoCommand = new TransactWriteItemsCommand({
    TransactItems: [
      ...(logStatement ? [logStatement] : []),
      {
        Update: {
          TableName: genericConfig.StripeLinksDynamoTableName,
          Key: {
            userId: { S: entry.userId },
            linkId: { S: entry.linkId },
          },
          UpdateExpression: "SET active = :new_val, expiresAt = :ttl",
          ConditionExpression: "active = :old_val",
          ExpressionAttributeValues: {
            ":new_val": { BOOL: false },
            ":old_val": { BOOL: true },
            ":ttl": { N: expiresAt.toString() },
          },
        },
      },
    ],
  });
  if (entry.productId) {
    requestLog.debug(`Deactivating Stripe product ${entry.productId}`);
    await stripeClient.products.update(
      entry.productId,
      { active: false },
      stripeRequestOptions(deadline),
    );
  }
  requestLog.debug(`Deactivating Stripe link ${entry.linkId}`);
  await stripeClient.paymentLinks.update(
    entry.linkId,
    { active: false },
    stripeRequestOptions(deadline),
  );
  try {
    await dynamoClient.send(dynamoCommand, awsOptions(deadline));
  } catch (error) {
    const conditional =
      isConditionalCheckFailed(error) ||
      (error instanceof Error &&
        error.name === "TransactionCanceledException" &&
        error.message.includes("ConditionalCheckFailed"));
    if (!conditional) {
      throw error;
    }
    // Prove the presentation row is already inactive before treating this as
    // complete; a missing or still-active row means we must retry.
    const row = await dynamoClient.send(
      new GetItemCommand({
        TableName: genericConfig.StripeLinksDynamoTableName,
        Key: {
          userId: { S: entry.userId },
          linkId: { S: entry.linkId },
        },
        ConsistentRead: true,
      }),
      awsOptions(deadline),
    );
    const item = row.Item ? unmarshall(row.Item) : null;
    if (item && item.active === false) {
      return;
    }
    throw error;
  }
};
