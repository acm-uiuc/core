import { FastifyPluginAsync } from "fastify";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import rawbody from "fastify-raw-body";
import stripe, { Stripe } from "stripe";
import * as z from "zod/v4";
import { withRoles, withTags, withTurnstile } from "api/components/index.js";
import { AppRoles } from "common/roles.js";
import { genericConfig } from "common/config.js";
import { getSecretValue } from "api/plugins/auth.js";
import {
  BaseError,
  InternalServerError,
  ValidationError,
} from "common/errors/index.js";
import { verifyUiucAccessToken } from "api/functions/uin.js";
import rateLimiter from "api/plugins/rateLimiter.js";
import {
  listProducts,
  getProduct,
  createStoreCheckout,
  getOrder,
  listOrdersByUser,
  listAllOrders,
  processStorePaymentSuccess,
  processStorePaymentFailure,
  createProduct,
} from "api/functions/store.js";
import {
  listProductsResponseSchema,
  getProductResponseSchema,
  createCheckoutRequestSchema,
  createCheckoutResponseSchema,
  getOrderResponseSchema,
  listOrdersResponseSchema,
  orderStatusEnum,
  productWithVariantsSchema,
  createProductRequestSchema,
} from "common/types/store.js";
import { assertAuthenticated } from "api/authenticated.js";

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

  // ============ Public Routes ============

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
                schema: listProductsResponseSchema,
              },
            },
          },
        },
      }),
    },
    async (request, reply) => {
      const products = await listProducts({
        dynamoClient: fastify.dynamoClient,
        includeInactive: false,
      });
      return reply.send({ products });
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
                schema: getProductResponseSchema,
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
      });
      return reply.send(product);
    },
  );

  // ============ Authenticated User Routes ============

  // Create checkout session
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/checkout",
    {
      schema: withTurnstile(
        {},
        withTags(["Store"], {
          summary: "Create a checkout session for purchasing items.",
          headers: z.object({
            "x-uiuc-token": z.jwt().min(1).meta({
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
      const { userPrincipalName } = await verifyUiucAccessToken({
        accessToken,
        logger: request.log,
      });
      let accessedFrom = request.headers.origin;
      if (!accessedFrom) {
        request.log.warn(
          "No Origin header found, setting redir base URL to https://acm.illinois.edu",
        );
        accessedFrom = "https://acm.illinois.edu";
      }
      const result = await createStoreCheckout({
        userId: userPrincipalName,
        items: request.body.items,
        successUrl: `${accessedFrom}${request.body.successRedirPath}`,
        cancelUrl: `${accessedFrom}${request.body.cancelRedirPath}`,
        dynamoClient: fastify.dynamoClient,
        redisClient: fastify.redisClient,
        stripeApiKey: fastify.secretConfig.stripe_secret_key,
        logger: request.log,
        baseUrl: fastify.environmentConfig.UserFacingUrl,
      });

      return reply.status(201).send(result);
    },
  );

  // Get user's orders
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/orders/me",
    {
      schema: withTags(["Store"], {
        summary: "Get your orders.",
        headers: z.object({
          "x-uiuc-token": z.jwt().min(1).meta({
            description:
              "An access token for the user in the UIUC Entra ID tenant.",
          }),
        }),
        response: {
          200: {
            description: "List of your orders.",
            content: {
              "application/json": {
                schema: listOrdersResponseSchema,
              },
            },
          },
        },
      }),
    },
    async (request, reply) => {
      const accessToken = request.headers["x-uiuc-token"];
      const { userPrincipalName } = await verifyUiucAccessToken({
        accessToken,
        logger: request.log,
      });

      const orders = await listOrdersByUser({
        userId: userPrincipalName,
        dynamoClient: fastify.dynamoClient,
        logger: request.log,
      });

      return reply.send({ orders });
    },
  );

  // Get a specific order
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/orders/:orderId",
    {
      schema: withTags(["Store"], {
        summary: "Get details of a specific order.",
        headers: z.object({
          "x-uiuc-token": z.jwt().min(1).meta({
            description:
              "An access token for the user in the UIUC Entra ID tenant.",
          }),
        }),
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
    },
    async (request, reply) => {
      const accessToken = request.headers["x-uiuc-token"];
      const { userPrincipalName } = await verifyUiucAccessToken({
        accessToken,
        logger: request.log,
      });

      const order = await getOrder({
        orderId: request.params.orderId,
        dynamoClient: fastify.dynamoClient,
      });

      // Verify user owns this order (unless they have admin access)
      if (order.userId !== userPrincipalName) {
        // Check if user has admin role to bypass ownership check
        try {
          await fastify.authorize(
            request,
            {} as any, // reply not needed for role check
            [AppRoles.STORE_MANAGER, AppRoles.STORE_FULFILLMENT],
            false,
          );
        } catch {
          // User doesn't have admin access, pretend order doesn't exist
          throw new ValidationError({ message: "Order not found." });
        }
      }

      return reply.send(order);
    },
  );

  // ============ Admin Routes ============

  // List all products (including inactive) - Admin only
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/admin/products",
    {
      schema: withRoles(
        [AppRoles.STORE_MANAGER],
        withTags(["Store"], {
          summary: "List all products (including inactive) for management.",
          response: {
            200: {
              description: "List of all products.",
              content: {
                "application/json": {
                  schema: listProductsResponseSchema,
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      const products = await listProducts({
        dynamoClient: fastify.dynamoClient,
        includeInactive: true,
      });
      return reply.send({ products });
    }),
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/admin/products",
    {
      schema: withRoles(
        [AppRoles.STORE_MANAGER],
        withTags(["Store"], {
          summary: "Create a new product with variants.",
          body: createProductRequestSchema,
          response: {
            201: {
              description: "Product created successfully.",
              content: {
                "application/json": {
                  schema: z.object({
                    success: z.boolean(),
                    productId: z.string(),
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
      await createProduct({
        productData: request.body,
        dynamoClient: fastify.dynamoClient,
        logger: request.log,
        stripeApiKey: fastify.secretConfig.stripe_secret_key,
      });

      return reply.status(201).send({
        success: true,
        productId: request.body.productId,
      });
    }),
  );

  // Get all orders (admin) with optional filters
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/admin/orders",
    {
      schema: withRoles(
        [AppRoles.STORE_MANAGER, AppRoles.STORE_FULFILLMENT],
        withTags(["Store"], {
          summary: "List all orders for management.",
          querystring: z.object({
            status: orderStatusEnum.optional(),
            limit: z.coerce.number().int().min(1).max(100).optional(),
          }),
          response: {
            200: {
              description: "List of orders.",
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
      const orders = await listAllOrders({
        dynamoClient: fastify.dynamoClient,
        status: request.query.status,
        limit: request.query.limit,
      });
      return reply.send({ orders });
    }),
  );

  // Get order by ID (admin)
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/admin/orders/:orderId",
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
        // Use the store-specific webhook secret
        const webhookSecret = fastify.secretConfig.store_stripe_endpoint_secret;
        event = stripe.webhooks.constructEvent(
          request.rawBody,
          sig,
          webhookSecret as string,
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

          const orderId = metadata.orderId;
          const userId = metadata.userId;
          const paymentIntentId = session.payment_intent?.toString();

          if (!orderId || !userId || !paymentIntentId) {
            request.log.warn(
              { orderId, userId, paymentIntentId },
              "Missing required metadata in store webhook",
            );
            return reply
              .status(200)
              .send({ handled: false, requestId: request.id });
          }

          request.log.info(
            { orderId, userId, paymentIntentId },
            "Processing store payment success",
          );

          const result = await processStorePaymentSuccess({
            orderId,
            userId,
            paymentIntentId,
            dynamoClient: fastify.dynamoClient,
            stripeApiKey: fastify.secretConfig.stripe_secret_key as string,
            logger: request.log,
          });

          return reply.status(200).send({
            handled: result.success,
            requestId: request.id,
            error: result.error,
          });
        }

        case "checkout.session.expired":
        case "checkout.session.async_payment_failed": {
          const session = event.data.object as Stripe.Checkout.Session;
          const metadata = session.metadata;

          // Only process store checkouts
          if (metadata?.initiator !== "acm-store") {
            return reply
              .status(200)
              .send({ handled: false, requestId: request.id });
          }

          const orderId = metadata.orderId;
          const userId = metadata.userId;
          const paymentIntentId = session.payment_intent?.toString() || "";

          if (orderId && userId) {
            request.log.info(
              { orderId, userId, eventType: event.type },
              "Processing store payment failure/expiry",
            );

            await processStorePaymentFailure({
              orderId,
              userId,
              paymentIntentId,
              dynamoClient: fastify.dynamoClient,
              logger: request.log,
            });
          }

          return reply
            .status(200)
            .send({ handled: true, requestId: request.id });
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
