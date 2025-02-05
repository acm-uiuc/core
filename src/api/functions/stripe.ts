import { FastifyBaseLogger } from "fastify";
import Stripe from "stripe";

export type StripeLinkCreateParams = {
  invoiceId: string;
  invoiceAmountUsd: number;
  contactName: string;
  contactEmail: string;
  createdBy: string;
  stripeApiKey: string;
  logger: FastifyBaseLogger;
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
  logger,
  stripeApiKey,
}: StripeLinkCreateParams): Promise<string> => {
  const stripe = new Stripe(stripeApiKey);
  const description = `Created For: ${contactName} (${contactEmail}) by ${createdBy}.`;
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
  logger.info(
    { type: "audit", actor: createdBy, target: invoiceId },
    "Created Stripe payment link",
  );
  return paymentLink.url;
};
