import { ValidLoggers } from "api/types.js";
import { isProd } from "api/utils.js";
import { InternalServerError, ValidationError } from "common/errors/index.js";
import { capitalizeFirstLetter } from "common/types/roomRequest.js";
import Stripe from "stripe";

export type StripeLinkCreateParams = {
  invoiceId: string;
  invoiceAmountUsd: number;
  contactName: string;
  contactEmail: string;
  createdBy: string;
  stripeApiKey: string;
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
  customFields?: Stripe.Checkout.SessionCreateParams.CustomField[];
  captureMethod?: "automatic" | "manual"; // manual = pre-auth only
  customText?: Stripe.Checkout.SessionCreateParams.CustomText;
};

export type StripeCheckoutSessionCreateWithCustomerParams = {
  successUrl?: string;
  returnUrl?: string;
  customerId: string;
  stripeApiKey: string;
  items: { price: string; quantity: number }[];
  initiator: string;
  metadata?: Stripe.Checkout.SessionCreateParams["metadata"];
  allowPromotionCodes: boolean;
  customFields?: Stripe.Checkout.SessionCreateParams.CustomField[];
  captureMethod?: "automatic" | "manual"; // manual = pre-auth only
  customText?: Stripe.Checkout.SessionCreateParams.CustomText;
};

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
}: StripeLinkCreateParams): Promise<{
  linkId: string;
  priceId: string;
  productId: string;
  url: string;
}> => {
  const stripe = new Stripe(stripeApiKey);
  const description = `Created for ${contactName} (${contactEmail}) by ${createdBy}.`;
  const product = await stripe.products.create({
    name: `Payment for Invoice: ${invoiceId}`,
    description,
  });
  const price = await stripe.prices.create({
    currency: "usd",
    unit_amount: invoiceAmountUsd,
    product: product.id,
  });
  const paymentLink = await stripe.paymentLinks.create({
    line_items: [
      {
        price: price.id,
        quantity: 1,
      },
    ],
    payment_method_types: ["card", "us_bank_account"],
  });
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
}: StripeCheckoutSessionCreateParams): Promise<string> => {
  const stripe = new Stripe(stripeApiKey);
  const payload: Stripe.Checkout.SessionCreateParams = {
    success_url: successUrl || "",
    cancel_url: returnUrl || "",
    payment_method_types: ["card"],
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
    ...(captureMethod && {
      payment_intent_data: {
        capture_method: captureMethod,
      },
    }),
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
}: StripeCheckoutSessionCreateWithCustomerParams): Promise<string> => {
  const stripe = new Stripe(stripeApiKey);
  const payload: Stripe.Checkout.SessionCreateParams = {
    success_url: successUrl || "",
    cancel_url: returnUrl || "",
    payment_method_types: ["card"],
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
    allow_promotion_codes: allowPromotionCodes,
    custom_text: customText,
    custom_fields: customFields,
    ...(captureMethod && {
      payment_intent_data: {
        capture_method: captureMethod,
      },
    }),
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
}: {
  paymentIntentId: string;
  stripeApiKey: string;
  stripeClient?: Stripe;
}) => {
  const stripe = stripeClient || new Stripe(stripeApiKey);
  return await stripe.paymentIntents.retrieve(paymentIntentId);
};

export const getPaymentMethodForPaymentIntent = async ({
  paymentIntentId,
  stripeApiKey,
}: {
  paymentIntentId: string;
  stripeApiKey: string;
}) => {
  const stripe = new Stripe(stripeApiKey);
  const paymentIntentData = await getStripePaymentIntentData({
    paymentIntentId,
    stripeApiKey,
    stripeClient: stripe,
  });
  if (!paymentIntentData) {
    throw new InternalServerError({
      internalLog: `Could not find payment intent data for payment intent ID "${paymentIntentId}".`,
    });
  }
  const paymentMethodId = paymentIntentData.payment_method?.toString();
  if (!paymentMethodId) {
    throw new InternalServerError({
      internalLog: `Could not find payment method ID for payment intent ID "${paymentIntentId}".`,
    });
  }
  const paymentMethodData =
    await stripe.paymentMethods.retrieve(paymentMethodId);
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
] as const;
export type SupportedStripePaymentMethod =
  (typeof supportedStripePaymentMethods)[number];
export const paymentMethodTypeToFriendlyName: Record<
  SupportedStripePaymentMethod,
  string
> = {
  us_bank_account: "ACH Direct Debit",
  card: "Credit/Debit Card",
  card_present: "Credit/Debit Card (Card Present)",
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
  return await stripe.paymentIntents.capture(paymentIntentId, {
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
    await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        reason: cancellationReason,
      },
      { idempotencyKey: `${idempotencyKey}-refund` },
    );
  }
};

export const shouldRetryStripeError = (error: any): boolean => {
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
