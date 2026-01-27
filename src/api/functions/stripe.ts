import { isProd } from "api/utils.js";
import { InternalServerError, ValidationError } from "common/errors/index.js";
import { capitalizeFirstLetter } from "common/types/roomRequest.js";
import Stripe from "stripe";
import { createLock, IoredisAdapter, type SimpleLock } from "redlock-universal";
import { Redis } from "api/types.js";
import {
  TransactWriteItemsCommand,
  QueryCommand,
  UpdateItemCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { genericConfig } from "common/config.js";
import { marshall } from "@aws-sdk/util-dynamodb";

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
};

export type StripeCheckoutSessionCreateWithCustomerParams = {
  successUrl?: string;
  returnUrl?: string;
  customerId: string;
  stripeApiKey: string;
  items: { price: string; quantity: number }[];
  initiator: string;
  metadata?: Record<string, string>;
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

export type checkCustomerParams = {
  acmOrg: string;
  emailDomain: string;
  redisClient: Redis;
  dynamoClient: DynamoDBClient;
  customerEmail: string;
  customerName: string;
  stripeApiKey: string;
};

export type CheckOrCreateResult = {
  customerId: string;
  needsConfirmation?: boolean;
  current?: { name?: string | null; email?: string | null };
  incoming?: { name: string; email: string };
};

export const checkOrCreateCustomer = async ({
  acmOrg,
  emailDomain,
  redisClient,
  dynamoClient,
  customerEmail,
  customerName,
  stripeApiKey,
}: checkCustomerParams): Promise<CheckOrCreateResult> => {
  const normalizedEmail = customerEmail.trim().toLowerCase();
  const [, domainPart] = normalizedEmail.split("@");

  if (!domainPart) {
    throw new Error(`Could not derive email domain for "${customerEmail}".`);
  }

  const normalizedDomain = domainPart.toLowerCase();

  const lock = createLock({
    adapter: new IoredisAdapter(redisClient),
    key: `stripe:${acmOrg}:${normalizedDomain}`,
    retryAttempts: 5,
    retryDelay: 300,
  }) as SimpleLock;

  const pk = `${acmOrg}#${normalizedDomain}`;

  return await lock.using(async () => {
    const checkCustomer = new QueryCommand({
      TableName: genericConfig.StripePaymentsDynamoTableName,
      KeyConditionExpression: "primaryKey = :pk AND sortKey = :sk",
      ExpressionAttributeValues: {
        ":pk": { S: pk },
        ":sk": { S: "CUSTOMER" },
      },
      ConsistentRead: true,
    });

    const customerResponse = await dynamoClient.send(checkCustomer);

    if (customerResponse.Count === 0) {
      const customer = await createStripeCustomer({
        email: normalizedEmail,
        name: customerName,
        stripeApiKey,
      });

      const createCustomer = new TransactWriteItemsCommand({
        TransactItems: [
          {
            Put: {
              TableName: genericConfig.StripePaymentsDynamoTableName,
              Item: marshall(
                {
                  primaryKey: pk,
                  sortKey: "CUSTOMER",
                  stripeCustomerId: customer,
                  totalAmount: 0,
                  createdAt: new Date().toISOString(),
                },
                { removeUndefinedValues: true },
              ),
              ConditionExpression:
                "attribute_not_exists(primaryKey) AND attribute_not_exists(sortKey)",
            },
          },
          {
            Put: {
              TableName: genericConfig.StripePaymentsDynamoTableName,
              Item: marshall(
                {
                  primaryKey: pk,
                  sortKey: `EMAIL#${normalizedEmail}`,
                  stripeCustomerId: customer,
                  createdAt: new Date().toISOString(),
                },
                { removeUndefinedValues: true },
              ),
              ConditionExpression:
                "attribute_not_exists(primaryKey) AND attribute_not_exists(sortKey)",
            },
          },
        ],
      });
      await dynamoClient.send(createCustomer);
      return { customerId: customer };
    }

    const existingCustomerId = (customerResponse.Items![0] as any)
      .stripeCustomerId.S as string;

    const stripeClient = new Stripe(stripeApiKey);
    const stripeCustomer =
      await stripeClient.customers.retrieve(existingCustomerId);

    const liveName =
      "name" in stripeCustomer ? (stripeCustomer as any).name : null;
    const liveEmail =
      "email" in stripeCustomer ? (stripeCustomer as any).email : null;

    const needsConfirmation =
      (!!liveName && liveName !== customerName) ||
      (!!liveEmail && liveEmail.toLowerCase() !== normalizedEmail);

    const ensureEmailMap = new TransactWriteItemsCommand({
      TransactItems: [
        {
          Put: {
            TableName: genericConfig.StripePaymentsDynamoTableName,
            Item: marshall(
              {
                primaryKey: pk,
                sortKey: `EMAIL#${normalizedEmail}`,
                stripeCustomerId: existingCustomerId,
                createdAt: new Date().toISOString(),
              },
              { removeUndefinedValues: true },
            ),
            ConditionExpression:
              "attribute_not_exists(primaryKey) AND attribute_not_exists(sortKey)",
          },
        },
      ],
    });

    try {
      await dynamoClient.send(ensureEmailMap);
    } catch (e) {
      if (
        !(e instanceof Error) ||
        !e.name.includes("ConditionalCheckFailedException")
      ) {
        console.warn(
          `Failed to create EMAIL# mapping for ${normalizedEmail}:`,
          e,
        );
      }
    }

    if (needsConfirmation) {
      return {
        customerId: existingCustomerId,
        needsConfirmation: true,
        current: { name: liveName ?? null, email: liveEmail ?? null },
        incoming: { name: customerName, email: normalizedEmail },
      };
    }

    return { customerId: existingCustomerId };
  });
};

export type InvoiceAddParams = {
  acmOrg: string;
  emailDomain: string;
  invoiceId: string;
  invoiceAmountUsd: number;
  redisClient: Redis;
  dynamoClient: DynamoDBClient;
  contactEmail: string;
  contactName: string;
  stripeApiKey: string;
};

export const addInvoice = async ({
  contactName,
  contactEmail,
  acmOrg,
  invoiceId,
  invoiceAmountUsd,
  emailDomain,
  redisClient,
  dynamoClient,
  stripeApiKey,
}: InvoiceAddParams): Promise<CheckOrCreateResult> => {
  const normalizedEmail = contactEmail.trim().toLowerCase();
  const [, domainPart] = normalizedEmail.split("@");

  if (!domainPart) {
    throw new Error(`Could not derive email domain for "${contactEmail}".`);
  }

  const normalizedDomain = domainPart.toLowerCase();
  const pk = `${acmOrg}#${normalizedDomain}`;

  const result = await checkOrCreateCustomer({
    acmOrg,
    emailDomain: normalizedDomain,
    redisClient,
    dynamoClient,
    customerEmail: contactEmail,
    customerName: contactName,
    stripeApiKey,
  });

  if (result.needsConfirmation) {
    return result;
  }

  const dynamoCommand = new TransactWriteItemsCommand({
    TransactItems: [
      {
        Put: {
          TableName: genericConfig.StripePaymentsDynamoTableName,
          Item: marshall(
            {
              primaryKey: pk,
              sortKey: `CHARGE#${invoiceId}`,
              invoiceAmtUsd: invoiceAmountUsd,
              createdAt: new Date().toISOString(),
            },
            { removeUndefinedValues: true },
          ),
          ConditionExpression:
            "attribute_not_exists(primaryKey) AND attribute_not_exists(sortKey)",
        },
      },
      {
        Update: {
          TableName: genericConfig.StripePaymentsDynamoTableName,
          Key: {
            primaryKey: { S: pk },
            sortKey: { S: "CUSTOMER" },
          },
          UpdateExpression: "SET totalAmount = totalAmount + :inc",
          ExpressionAttributeValues: {
            ":inc": { N: invoiceAmountUsd.toString() },
          },
        },
      },
    ],
  });

  await dynamoClient.send(dynamoCommand);
  return { customerId: result.customerId };
};
