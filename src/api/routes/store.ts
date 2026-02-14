import { FastifyPluginAsync } from "fastify";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import rawbody from "fastify-raw-body";
import stripe, { Stripe } from "stripe";
import * as z from "zod/v4";
import {
  ts,
  withRoles,
  withTags,
  withTurnstile,
} from "api/components/index.js";
import { AppRoles } from "common/roles.js";
import { genericConfig, STORE_CACHED_DURATION } from "common/config.js";
import {
  BaseError,
  UnauthenticatedError,
  ValidationError,
} from "common/errors/index.js";
import { getUserIdByUin, verifyUiucAccessToken } from "api/functions/uin.js";
import rateLimiter from "api/plugins/rateLimiter.js";
import {
  listProducts,
  getProduct,
  createStoreCheckout,
  getOrder,
  createProduct,
  listProductLineItems,
  modifyProduct,
  refundOrder,
  fulfillLineItems,
  listOrdersByUser,
} from "api/functions/store.js";
import {
  createCheckoutRequestSchema,
  createCheckoutResponseSchema,
  getOrderResponseSchema,
  listOrdersResponseSchema,
  createProductRequestSchema,
  listProductsPublicResponseSchema,
  productWithVariantsPublicCountSchema,
  modifyProductSchema,
  listProductsAdminResponseSchema,
  ModifyProductRequest,
  orderStatusEnum,
} from "common/types/store.js";
import { assertAuthenticated } from "api/authenticated.js";
import { AvailableSQSFunctions, SQSPayload } from "common/types/sqsMessage.js";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { createPresignedPut } from "api/functions/s3.js";
import { S3Client } from "@aws-sdk/client-s3";
import { illinoisUin } from "common/types/generic.js";

export const STORE_CLIENT_HTTP_CACHE_POLICY = `public, max-age=${STORE_CACHED_DURATION}, stale-while-revalidate=${STORE_CACHED_DURATION}, stale-if-error=${STORE_CACHED_DURATION}`;

const storeRoutes: FastifyPluginAsync = async (fastify, _options) => {
  // Register raw body plugin for webhook signature verification
  await fastify.register(rawbody, {
    field: "rawBody",
    global: false,
    runFirst: true,
  });

  // Register rate limiter
  await fastify.register(rateLimiter, {
    limit: 60,
    duration: 60,
    rateLimitIdentifier: "store",
  });

  // List all available products
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/products",
    {
      schema: withTags(["Store"], {
        summary: "List all available products in the store.",
        response: {
          200: {
            description: "List of products.",
            content: {
              "application/json": {
                schema: listProductsPublicResponseSchema,
              },
            },
          },
        },
      }),
    },
    async (_request, reply) => {
      const products = await listProducts({
        dynamoClient: fastify.dynamoClient,
        includeInactive: false,
      });
      return reply
        .header("Cache-Control", STORE_CLIENT_HTTP_CACHE_POLICY)
        .send({ products });
    },
  );

  // Get a single product
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/products/:productId",
    {
      schema: withTags(["Store"], {
        summary: "Get details of a specific product.",
        params: z.object({
          productId: z.string().min(1),
        }),
        response: {
          200: {
            description: "Product details.",
            content: {
              "application/json": {
                schema: productWithVariantsPublicCountSchema,
              },
            },
          },
        },
      }),
    },
    async (request, reply) => {
      const product = await getProduct({
        productId: request.params.productId,
        dynamoClient: fastify.dynamoClient,
        includeInactive: false,
      });
      return reply.send(product);
    },
  );

  // Create checkout session
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/checkout",
    {
      schema: withTurnstile(
        {},
        withTags(["Store"], {
          summary: "Create a checkout session for purchasing items.",
          headers: z.object({
            "x-uiuc-token": z.jwt().optional().meta({
              description:
                "An access token for the user in the UIUC Entra ID tenant.",
            }),
          }),
          body: createCheckoutRequestSchema,
          response: {
            201: {
              description: "Checkout session created.",
              content: {
                "application/json": {
                  schema: createCheckoutResponseSchema,
                },
              },
            },
          },
        }),
      ),
    },
    async (request, reply) => {
      const accessToken = request.headers["x-uiuc-token"];
      let userId: string;
      let isVerifiedIdentity = false;
      if (accessToken) {
        userId = (
          await verifyUiucAccessToken({
            accessToken,
            logger: request.log,
          })
        ).userPrincipalName;
        isVerifiedIdentity = true;
      } else if (request.body.email) {
        userId = request.body.email;
      } else {
        throw new ValidationError({ message: "Could not find user ID." });
      }

      let accessedFrom = request.headers.origin;
      if (!accessedFrom) {
        request.log.warn(
          "No Origin header found, setting redir base URL to https://acm.illinois.edu",
        );
        accessedFrom = "https://acm.illinois.edu";
      }
      const result = await createStoreCheckout({
        userId,
        items: request.body.items,
        successUrl: `${accessedFrom}${request.body.successRedirPath}`,
        cancelUrl: `${accessedFrom}${request.body.cancelRedirPath}`,
        dynamoClient: fastify.dynamoClient,
        redisClient: fastify.redisClient,
        stripeApiKey: fastify.secretConfig.stripe_secret_key,
        logger: request.log,
        baseUrl: fastify.environmentConfig.UserFacingUrl,
        isVerifiedIdentity,
      });

      return reply.status(201).send(result);
    },
  );

  // List all products (including inactive) - Admin only
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/admin/products",
    {
      schema: withRoles(
        [AppRoles.STORE_MANAGER, AppRoles.STORE_FULFILLMENT],
        withTags(["Store"], {
          summary: "List all products (including inactive) for management.",
          response: {
            200: {
              description: "List of all products.",
              content: {
                "application/json": {
                  schema: listProductsAdminResponseSchema,
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (_request, reply) => {
      const products = await listProducts({
        dynamoClient: fastify.dynamoClient,
        includeInactive: true,
      });
      return reply.send({ products });
    }),
  );

  // Create a product - Admin only
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/admin/products",
    {
      schema: withRoles(
        [AppRoles.STORE_MANAGER],
        withTags(["Store"], {
          summary: "Create a new product with variants.",
          body: createProductRequestSchema
            .refine(
              (data) =>
                !data.openAt || !data.closeAt || data.openAt < data.closeAt,
              { message: "openAt must be before closeAt" },
            )
            .refine(
              (data) =>
                data.inventoryMode !== "PER_PRODUCT"
                  ? !data.totalInventoryCount
                  : data.totalInventoryCount !== null,
              {
                message:
                  "totalInventoryCount is required when inventoryMode is PER_PRODUCT, and must not be provided otherwise",
              },
            ),
          response: {
            201: {
              description: "Product created successfully.",
              content: {
                "application/json": {
                  schema: z.object({
                    success: z.boolean(),
                    productId: z.string(),
                    imageUploadPresignedUrl: z.optional(z.url()),
                  }),
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      let transformedBody;
      fastify.s3Client =
        fastify.s3Client || new S3Client({ region: genericConfig.AwsRegion });
      let presignedUrl: string | undefined = undefined;

      if (request.body.requestingImageUpload) {
        const { requestingImageUpload: _, ...rest } = request.body;
        const fileExtension = ".webp";
        const itemKey = `public/store/images/${request.body.productId}.${fileExtension}`;
        transformedBody = {
          ...rest,
          imageUrl: `https://${fastify.environmentConfig.AssetsBucketPublicUrl}/${itemKey}`,
        };
        presignedUrl = await createPresignedPut({
          s3client: fastify.s3Client,
          bucketName: fastify.environmentConfig.AssetsBucketId,
          key: itemKey,
          length: request.body.requestingImageUpload.fileSize,
          mimeType: request.body.requestingImageUpload.mimeType,
          md5hash: request.body.requestingImageUpload.contentMd5Hash,
        });
      } else {
        transformedBody = request.body;
      }
      await createProduct({
        productData: transformedBody,
        dynamoClient: fastify.dynamoClient,
        logger: request.log,
        stripeApiKey: fastify.secretConfig.stripe_secret_key,
        actor: request.username,
      });

      return reply.status(201).send({
        success: true,
        productId: request.body.productId,
        ...(presignedUrl && { imageUploadPresignedUrl: presignedUrl }),
      });
    }),
  );

  // Modify a product entry
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().patch(
    "/admin/products/:productId",
    {
      schema: withRoles(
        [AppRoles.STORE_MANAGER],
        withTags(["Store"], {
          summary: "Modify the metadata for a given product.",
          params: z.object({
            productId: z.string().min(1),
          }),
          body: modifyProductSchema,
          response: {
            200: {
              description:
                "The product has been modified (with presigned URL for image upload).",
              content: {
                "application/json": {
                  schema: z.object({
                    success: z.boolean(),
                    imageUploadPresignedUrl: z.optional(z.url()),
                  }),
                },
              },
            },
            204: {
              description: "The product has been modified.",
              content: {
                "application/json": {
                  schema: z.undefined(),
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      fastify.s3Client =
        fastify.s3Client || new S3Client({ region: genericConfig.AwsRegion });
      let presignedUrl: string | undefined;
      let modifyData: Record<string, unknown> = { ...request.body };

      if (request.body.requestingImageUpload) {
        const { requestingImageUpload: _, ...rest } = modifyData;
        const fileExtension = ".webp";
        const itemKey = `public/store/images/${request.params.productId}.${fileExtension}`;
        modifyData = {
          ...rest,
          imageUrl: `https://${fastify.environmentConfig.AssetsBucketPublicUrl}/${itemKey}`,
        };
        presignedUrl = await createPresignedPut({
          s3client: fastify.s3Client,
          bucketName: fastify.environmentConfig.AssetsBucketId,
          key: itemKey,
          length: request.body.requestingImageUpload.fileSize,
          mimeType: request.body.requestingImageUpload.mimeType,
          md5hash: request.body.requestingImageUpload.contentMd5Hash,
        });
      }

      await modifyProduct({
        productId: request.params.productId,
        data: modifyData as ModifyProductRequest,
        actor: request.username,
        dynamoClient: fastify.dynamoClient,
        stripeApiKey: fastify.secretConfig.stripe_secret_key,
        logger: request.log,
      });

      if (presignedUrl) {
        return reply
          .status(200)
          .send({ success: true, imageUploadPresignedUrl: presignedUrl });
      }
      reply.status(204).send();
    }),
  );

  // Get all orders (admin) with optional filters
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/admin/orders/:productId",
    {
      schema: withRoles(
        [AppRoles.STORE_MANAGER, AppRoles.STORE_FULFILLMENT],
        withTags(["Store"], {
          summary: "List all orders/line items for a given product.",
          params: z.object({
            productId: z.string().min(1),
          }),
          response: {
            200: {
              description: "List of line items.",
              content: {
                "application/json": {
                  schema: listOrdersResponseSchema,
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      const items = await listProductLineItems({
        dynamoClient: fastify.dynamoClient,
        productId: request.params.productId,
        logger: request.log,
      });
      return reply.send({ items });
    }),
  );

  // Get all orders (admin) with optional filters
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/admin/orders/:orderId/refund",
    {
      schema: withRoles(
        [AppRoles.STORE_MANAGER],
        withTags(["Store"], {
          summary: "Refund an order.",
          params: z.object({
            orderId: z.string().min(1),
          }),
          body: z.object({
            releaseInventory: z.boolean(),
          }),
          response: {
            204: {
              description: "The order was refunded.",
              content: {
                "application/json": {
                  schema: z.undefined(),
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      await refundOrder({
        dynamoClient: fastify.dynamoClient,
        orderId: request.params.orderId,
        logger: request.log,
        actor: request.username,
        stripeApiKey: fastify.secretConfig.stripe_secret_key,
        ...request.body,
      });
      return reply.status(204).send();
    }),
  );

  // Fulfill order
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/admin/orders/:orderId/fulfill",
    {
      schema: withRoles(
        [AppRoles.STORE_MANAGER, AppRoles.STORE_FULFILLMENT],
        withTags(["Store"], {
          summary: "Fulfill an order's line items.",
          params: z.object({
            orderId: z.string().min(1),
          }),
          body: z.object({
            lineItemIds: z
              .array(z.string().min(1))
              .min(1)
              .max(20)
              .refine((items) => new Set(items).size === items.length, {
                error: "All line item IDs must be unique.",
              }),
          }),
          response: {
            204: {
              description: "The order's specified line items were fulfilled.",
              content: {
                "application/json": {
                  schema: z.undefined(),
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      await fulfillLineItems({
        dynamoClient: fastify.dynamoClient,
        orderId: request.params.orderId,
        logger: request.log,
        actor: request.username,
        lineItemIds: request.body.lineItemIds,
      });
      return reply.status(204).send();
    }),
  );

  // Fetch a user's orders - this route is POST because we don't want to put UINs in logs everywhere
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/admin/orders/fetchUserOrders",
    {
      schema: withRoles(
        [AppRoles.STORE_MANAGER, AppRoles.STORE_FULFILLMENT],
        withTags(["Store"], {
          summary: "Fetch a user's orders.",
          querystring: z.object({
            productId: z.string().min(1).optional().meta({
              description:
                "If specified, will only return results for this product ID.",
            }),
            orderStatus: orderStatusEnum.optional().meta({
              description:
                "If specified, will only return results where the order is in this state.",
            }),
          }),
          body: z.discriminatedUnion("type", [
            z.object({ type: z.literal("UIN"), uin: illinoisUin }),
          ]), // we may add more in the future
          response: {
            200: {
              description: "The user's orders were retrieved.",
              content: {
                "application/json": {
                  schema: z.array(getOrderResponseSchema),
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      const { productId, orderStatus } = request.query;
      const { dynamoClient } = fastify;
      let userId: string | undefined = undefined;
      switch (request.body.type) {
        case "UIN":
          userId = (
            await getUserIdByUin({ dynamoClient, uin: request.body.uin })
          ).id;
          break;
        default:
          throw new Error(
            `User was able to get to identity type ${request.body.type} which was never handled.`,
          );
      }
      const userOrders = await listOrdersByUser({
        userId,
        productId,
        dynamoClient,
        orderStatus,
      });
      return reply.status(200).send(userOrders);
    }),
  );

  // Get order by ID (admin)
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/admin/order/:orderId",
    {
      schema: withRoles(
        [AppRoles.STORE_MANAGER, AppRoles.STORE_FULFILLMENT],
        withTags(["Store"], {
          summary: "Get order details for management.",
          params: z.object({
            orderId: z.string().min(1),
          }),
          response: {
            200: {
              description: "Order details.",
              content: {
                "application/json": {
                  schema: getOrderResponseSchema,
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      const order = await getOrder({
        orderId: request.params.orderId,
        dynamoClient: fastify.dynamoClient,
      });
      return reply.send(order);
    }),
  );

  // ============ Webhook Route ============

  fastify.post(
    "/webhook",
    {
      config: { rawBody: true },
      schema: withTags(["Store"], {
        summary: "Stripe webhook handler for store payments.",
        hide: true,
      }),
    },
    async (request, reply) => {
      let event: Stripe.Event;
      if (!request.rawBody) {
        throw new ValidationError({ message: "Could not get raw body." });
      }

      try {
        const sig = request.headers["stripe-signature"];
        if (!sig || typeof sig !== "string") {
          throw new Error("Missing or invalid Stripe signature");
        }
        const webhookSecret = fastify.secretConfig.store_stripe_endpoint_secret;
        event = stripe.webhooks.constructEvent(
          request.rawBody,
          sig,
          webhookSecret,
        );
      } catch (err: unknown) {
        if (err instanceof BaseError) {
          throw err;
        }
        request.log.error({ err }, "Stripe webhook validation failed");
        throw new ValidationError({
          message: "Stripe webhook could not be validated.",
        });
      }

      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          const metadata = session.metadata;

          // Only process store checkouts
          if (metadata?.initiator !== "acm-store") {
            request.log.info(
              { initiator: metadata?.initiator },
              "Skipping non-store checkout session",
            );
            return reply
              .status(200)
              .send({ handled: false, requestId: request.id });
          }

          const isVerifiedIdentity = metadata?.isVerifiedIdentity === "true";
          const orderId = metadata.orderId;
          const userId = metadata.userId;
          const paymentIdentifier = session.id.toString();
          const paymentIntentId = session.payment_intent?.toString();

          if (!orderId || !userId || !paymentIdentifier) {
            request.log.warn(
              { orderId, userId, paymentIdentifier },
              "Missing required metadata in store webhook",
            );
            return reply
              .status(200)
              .send({ handled: false, requestId: request.id });
          }

          request.log.info(
            { orderId, userId, paymentIdentifier },
            "Queueing store payment success message",
          );
          const sqsPayload: SQSPayload<AvailableSQSFunctions.HandleStorePurchase> =
            {
              metadata: {
                reqId: request.id,
                initiator: event.id,
              },
              function: AvailableSQSFunctions.HandleStorePurchase,
              payload: {
                orderId,
                userId,
                paymentIdentifier,
                paymentIntentId,
                isVerifiedIdentity,
              },
            };
          const sqsClient = new SQSClient({ region: genericConfig.AwsRegion });
          const cmd = new SendMessageCommand({
            QueueUrl: fastify.environmentConfig.SqsQueueUrl,
            MessageBody: JSON.stringify(sqsPayload),
            MessageGroupId: "storePurchase",
          });
          const resp = await sqsClient.send(cmd);
          return reply.status(200).send({
            handled: true,
            requestId: request.id,
            queueId: resp.MessageId || "",
          });
        }
        default:
          request.log.info(
            { eventType: event.type },
            "Unhandled store webhook event type",
          );
          return reply
            .status(200)
            .send({ handled: false, requestId: request.id });
      }
    },
  );
};

export default storeRoutes;
