import { withRoles, withTags } from "api/components/index.js";
import { assertAuthenticated } from "api/authenticated.js";
import { FastifyPluginAsync } from "fastify";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import * as z from "zod/v4";
import {
  capturePaymentIntent,
  createCheckoutSession,
  getStripePaymentIntentData,
} from "api/functions/stripe.js";
import {
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  VendingTransaction,
  vendingInventorySchema,
  vendingTransactionSchema,
} from "common/types/vending.js";
import { randomUUID } from "node:crypto";
import { maxLength } from "common/types/generic.js";
import { AvailableSQSFunctions, SQSPayload } from "common/types/sqsMessage.js";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { genericConfig } from "common/config.js";
import { AppRoles } from "common/roles.js";
import {
  InsufficientInventoryError,
  InternalServerError,
  ItemNotAvailableError,
  ResourceConflictError,
  ValidationError,
} from "common/errors/index.js";
import rawbody from "fastify-raw-body";
import Stripe from "stripe";

const STRIPE_TRANSACTION_INITIATOR = "acm-vending";

const createCheckoutSessionSchema = z.object({
  slotId: z.string().min(1),
});

const completeCheckoutSessionSchema = z.object({
  id: z.string().min(1),
  mode: z.literal("payment"),
  status: z.literal("complete"),
  payment_intent: z.string().startsWith("pi_").min(4),
  amount_total: z.number().int().positive(),
  currency: z.literal("usd"),
  metadata: z.object({
    slotId: z.string().min(1),
    vendId: z.uuid(),
  }),
});

const captureVendPaymentSchema = z.object({
  vendId: z.uuid(),
  idempotencyKey: z.string().min(1).max(255),
});

const cancelCheckoutSessionSchema = z.object({
  vendId: z.uuid(),
  idempotencyKey: z.string().min(1).max(255),
});

const vendingPlugin: FastifyPluginAsync = async (fastify, _options) => {
  await fastify.register(rawbody, {
    field: "rawBody",
    global: false,
    runFirst: true,
  }); // needed for Stripe webhook signature verification

  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/create-checkout-session",
    {
      schema: withRoles(
        [AppRoles.VENDING_MACHINE],
        withTags(["Vending"], {
          summary:
            "Creates a Stripe checkout session for a vending transaction.",
          body: createCheckoutSessionSchema,
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      const inventoryResponse = await fastify.dynamoClient.send(
        new GetItemCommand({
          TableName: genericConfig.VendingInventoryTableName,
          Key: marshall({ slotId: request.body.slotId }),
          ConsistentRead: true,
        }),
      );
      if (!inventoryResponse.Item) {
        throw new ItemNotAvailableError({ message: "Vending slot not found." });
      }
      const inventory = vendingInventorySchema.parse(
        unmarshall(inventoryResponse.Item),
      );
      if (inventory.quantity < 1) {
        throw new InsufficientInventoryError({
          message: "The selected item is out of stock.",
        });
      }

      const stripe = new Stripe(fastify.secretConfig.stripe_secret_key);
      const price = await stripe.prices.retrieve(inventory.stripePriceId);
      if (
        price.currency !== "usd" ||
        inventory.price <= 0 ||
        Number(price.unit_amount_decimal) !== inventory.price
      ) {
        throw new InternalServerError({
          message:
            "The price listed on Stripe does not match the price internally recorded.",
        });
      }

      const vendId = randomUUID();
      const checkoutSession = await createCheckoutSession({
        stripeApiKey: fastify.secretConfig.stripe_secret_key,
        items: [{ price: inventory.stripePriceId, quantity: 1 }],
        initiator: STRIPE_TRANSACTION_INITIATOR,
        metadata: {
          slotId: inventory.slotId,
          vendId,
        },
        captureMethod: "manual",
        allowPromotionCodes: false,
        statementDescriptorSuffix: maxLength("VENDING", 7),
        delayedSettlementAllowed: false,
        customText: {
          submit: {
            message:
              "Your payment method will charged only if the item dispenses.",
          },
        },
        successUrl: "https://acm.gg",
        returnUrl: "https://acm.gg",
      });

      const transaction: VendingTransaction = {
        vendId,
        slotId: inventory.slotId,
        priceCents: inventory.price,
        itemName: inventory.itemName,
        checkoutSessionId: checkoutSession.id,
        paymentIntentId: null, // the payment intent will be created when the checkout session is completed (webhook)
        status: "pending_payment",
        paymentStatus: "pending",
        createdAt: Math.floor(Date.now() / 1000),
      };

      await fastify.dynamoClient.send(
        new PutItemCommand({
          TableName: genericConfig.VendingTransactionsTableName,
          Item: marshall(transaction),
          ConditionExpression: "attribute_not_exists(vendId)",
        }),
      );

      return reply.status(200).send({
        vendId,
        checkoutSession: {
          id: checkoutSession.id,
          url: checkoutSession.url,
        },
      });
    }),
  );

  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/checkout-completed",
    {
      config: { rawBody: true },
      schema: withTags(["Vending"], {
        summary:
          "Stripe webhook to confirm that the payment method was successfully authorized for a vend.",
        hide: true,
      }),
    },
    async (request, reply) => {
      const signature = request.headers["stripe-signature"];
      if (!request.rawBody || typeof signature !== "string") {
        throw new ValidationError({
          message: "Missing Stripe signature or raw request body.",
        });
      }

      let event: Stripe.Event;
      try {
        event = Stripe.webhooks.constructEvent(
          request.rawBody,
          signature,
          fastify.secretConfig.vending_stripe_endpoint_secret,
        );
      } catch {
        throw new ValidationError({
          message: "The Stripe webhook could not be successfully validated.",
        });
      }

      if (event.type !== "checkout.session.completed") {
        throw new ValidationError({
          message:
            "This route only accepts Stripe webhooks for the 'checkout.session.completed' event.",
        });
      }
      if (
        event.data.object.metadata?.initiator !== STRIPE_TRANSACTION_INITIATOR
      ) {
        throw new ValidationError({
          message: `This route only accepts requests for the '${STRIPE_TRANSACTION_INITIATOR}' initiator.`,
        });
      }

      const parsedCheckoutSession = completeCheckoutSessionSchema.safeParse(
        event.data.object,
      );
      if (!parsedCheckoutSession.success) {
        throw new ValidationError({
          message: "The checkout session is missing the vend metadata.",
        });
      }

      const checkoutSession = parsedCheckoutSession.data;
      const transactionResponse = await fastify.dynamoClient.send(
        new GetItemCommand({
          TableName: genericConfig.VendingTransactionsTableName,
          Key: marshall({ vendId: checkoutSession.metadata.vendId }),
          ConsistentRead: true,
        }),
      );
      if (!transactionResponse.Item) {
        throw new ItemNotAvailableError({
          message: "Vending transaction not found.",
        });
      }
      const transaction = vendingTransactionSchema.parse(
        unmarshall(transactionResponse.Item),
      );
      if (transaction.paymentStatus !== "pending") {
        return reply.status(200).send(); // in case the webhook gets sent more than once
      }
      const paymentIntent = await getStripePaymentIntentData({
        paymentIntentId: checkoutSession.payment_intent,
        stripeApiKey: fastify.secretConfig.stripe_secret_key,
      });
      if (
        paymentIntent.status !== "requires_capture" ||
        paymentIntent.amount_capturable !== transaction.priceCents
      ) {
        throw new ValidationError({
          message: "The payment is not fully authorized for capture.",
        });
      }

      await fastify.dynamoClient.send(
        new UpdateItemCommand({
          TableName: genericConfig.VendingTransactionsTableName,
          Key: marshall({ vendId: transaction.vendId }),
          UpdateExpression:
            "SET paymentIntentId = :paymentIntentId, #paymentStatus = :paymentStatus, #status = :status, authorizedAt = if_not_exists(authorizedAt, :authorizedAt)",
          ConditionExpression:
            "attribute_exists(vendId) AND #paymentStatus IN (:pending, :paymentStatus) AND #status IN (:pendingPayment, :status)",
          ExpressionAttributeNames: {
            "#status": "status",
            "#paymentStatus": "paymentStatus",
          },
          ExpressionAttributeValues: marshall({
            ":paymentIntentId": checkoutSession.payment_intent,
            ":paymentStatus": "authorized",
            ":status": "authorized",
            ":authorizedAt": Math.floor(Date.now() / 1000),
            ":pending": "pending",
            ":pendingPayment": "pending_payment",
          }),
        }),
      );

      const sqsMessageBody: SQSPayload<AvailableSQSFunctions.DispenseVendingItem> =
        {
          function: AvailableSQSFunctions.DispenseVendingItem,
          metadata: {
            reqId: request.id,
            initiator: event.id,
          },
          payload: parsedCheckoutSession.data.metadata,
        };

      const sqsClient = new SQSClient({ region: genericConfig.AwsRegion });
      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: fastify.environmentConfig.SqsQueueUrl,
          MessageBody: JSON.stringify(sqsMessageBody),
          MessageGroupId: "vendingDispensal",
        }),
      );
      return reply.status(200).send();
    },
  );

  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/capture",
    {
      schema: withRoles(
        [AppRoles.VENDING_MACHINE],
        withTags(["Vending"], {
          summary:
            "Captures an already authorized payment once the item has been dispensed.",
          body: captureVendPaymentSchema,
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      const transactionResponse = await fastify.dynamoClient.send(
        new GetItemCommand({
          TableName: genericConfig.VendingTransactionsTableName,
          Key: marshall({ vendId: request.body.vendId }),
          ConsistentRead: true,
        }),
      );
      if (!transactionResponse.Item) {
        throw new ItemNotAvailableError({
          message: "Vending transaction not found.",
        });
      }
      const transaction = vendingTransactionSchema.parse(
        unmarshall(transactionResponse.Item),
      );
      if (
        transaction.paymentStatus !== "authorized" ||
        !transaction.paymentIntentId
      ) {
        throw new ResourceConflictError({
          message: "The vending payment is not available for capture.",
        });
      }
      const paymentIntent = await getStripePaymentIntentData({
        paymentIntentId: transaction.paymentIntentId,
        stripeApiKey: fastify.secretConfig.stripe_secret_key,
      });
      const settledPayment = await capturePaymentIntent({
        stripeApiKey: fastify.secretConfig.stripe_secret_key,
        paymentIntentId: paymentIntent.id,
        idempotencyKey: request.body.idempotencyKey,
      });
      if (settledPayment.status !== "succeeded") {
        throw new ResourceConflictError({
          message: "Failed to capture the vending payment.",
        });
      }
      await fastify.dynamoClient.send(
        new UpdateItemCommand({
          TableName: genericConfig.VendingTransactionsTableName,
          Key: marshall({ vendId: transaction.vendId }),
          UpdateExpression:
            "SET #paymentStatus = :paymentStatus, capturedAt = if_not_exists(capturedAt, :capturedAt)",
          ConditionExpression:
            "attribute_exists(vendId) AND #paymentStatus IN (:authorized, :paymentStatus)",
          ExpressionAttributeNames: {
            "#paymentStatus": "paymentStatus",
          },
          ExpressionAttributeValues: marshall({
            ":paymentStatus": "captured",
            ":capturedAt": Math.floor(Date.now() / 1000),
            ":authorized": "authorized",
          }),
        }),
      );
      return reply.status(200).send();
    }),
  );

  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/cancel",
    {
      schema: withRoles(
        [AppRoles.VENDING_MACHINE],
        withTags(["Vending"], {
          summary:
            "Cancels a checkout session and releases any existing authorized payment holds.",
          body: cancelCheckoutSessionSchema,
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      const transactionResponse = await fastify.dynamoClient.send(
        new GetItemCommand({
          TableName: genericConfig.VendingTransactionsTableName,
          Key: marshall({ vendId: request.body.vendId }),
          ConsistentRead: true,
        }),
      );
      if (!transactionResponse.Item) {
        throw new ItemNotAvailableError({
          message: "Vending transaction not found.",
        });
      }
      const transaction = vendingTransactionSchema.parse(
        unmarshall(transactionResponse.Item),
      );
      if (transaction.paymentStatus === "canceled") {
        throw new ResourceConflictError({
          message: "The vending transaction has already been canceled.",
        });
      }

      const expiresCheckout =
        transaction.paymentStatus === "pending" &&
        transaction.status === "pending_payment";
      const revokesHold =
        transaction.paymentStatus === "authorized" &&
        transaction.status === "authorized" &&
        transaction.paymentIntentId !== null;
      if (!expiresCheckout && !revokesHold) {
        throw new ResourceConflictError({
          message: "The vending transaction cannot be canceled.",
        });
      }

      const stripe = new Stripe(fastify.secretConfig.stripe_secret_key);
      // If the payment method has not yet been authorized, expire the checkout session
      if (expiresCheckout) {
        const checkoutSession = await stripe.checkout.sessions.expire(
          transaction.checkoutSessionId,
          {},
          { idempotencyKey: request.body.idempotencyKey },
        );
        if (checkoutSession.status !== "expired") {
          throw new ResourceConflictError({
            message: "The checkout session could not be successfully expired.",
          });
        }
      } else if (revokesHold) {
        const paymentIntent = await stripe.paymentIntents.cancel(
          transaction.paymentIntentId!,
          {},
          { idempotencyKey: request.body.idempotencyKey },
        );
        if (paymentIntent.status !== "canceled") {
          throw new ResourceConflictError({
            message: "The payment intent could not be successfully canceled.",
          });
        }
      }

      await fastify.dynamoClient.send(
        new UpdateItemCommand({
          TableName: genericConfig.VendingTransactionsTableName,
          Key: marshall({ vendId: transaction.vendId }),
          UpdateExpression:
            "SET #status = :canceled, #paymentStatus = :canceled, canceledAt = if_not_exists(canceledAt, :canceledAt)",
          ConditionExpression: expiresCheckout
            ? "checkoutSessionId = :sessionId AND #status = :expectedStatus AND #paymentStatus = :expectedPaymentStatus"
            : "checkoutSessionId = :sessionId AND paymentIntentId = :paymentIntentId AND #status = :expectedStatus AND #paymentStatus = :expectedPaymentStatus",
          ExpressionAttributeNames: {
            "#status": "status",
            "#paymentStatus": "paymentStatus",
          },
          ExpressionAttributeValues: marshall({
            ":sessionId": transaction.checkoutSessionId,
            ":expectedStatus": transaction.status,
            ":expectedPaymentStatus": transaction.paymentStatus,
            ...(revokesHold && {
              ":paymentIntentId": transaction.paymentIntentId,
            }),
            ":canceled": "canceled",
            ":canceledAt": Math.floor(Date.now() / 1000),
          }),
        }),
      );
      return reply.status(200).send();
    }),
  );
};

export default vendingPlugin;
