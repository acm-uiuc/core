import { InternalServerError } from "common/errors/index.js";
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
  allowPromotionCodes: boolean;
  customFields?: Stripe.Checkout.SessionCreateParams.CustomField[];
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
      initiator,
    },
    allow_promotion_codes: allowPromotionCodes,
    custom_fields: customFields,
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
