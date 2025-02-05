import Stripe from "stripe";

export type StripeLinkCreateParams = {
  invoiceId: string;
  invoiceAmountUsd: number;
  contactName: string;
  contactEmail: string;
  createdBy: string;
  stripeApiKey: string;
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
  return {
    url: paymentLink.url,
    linkId: paymentLink.id,
    productId: product.id,
    priceId: price.id,
  };
};
