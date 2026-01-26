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
import {
  genericConfig,
  STALE_IF_ERROR_CACHED_TIME,
  STORE_CACHED_DURATION,
} from "common/config.js";
import { getSecretValue } from "api/plugins/auth.js";
import {
  BaseError,
  InternalServerError,
  UnauthenticatedError,
  ValidationError,
} from "common/errors/index.js";
import { verifyUiucAccessToken } from "api/functions/uin.js";
import rateLimiter from "api/plugins/rateLimiter.js";
import {
  listProducts,
  getProduct,
  createStoreCheckout,
  getOrder,
  processStorePaymentSuccess,
  createProduct,
  listProductOrders,
} from "api/functions/store.js";
import {
  listProductsResponseSchema,
  createCheckoutRequestSchema,
  createCheckoutResponseSchema,
  getOrderResponseSchema,
  listOrdersResponseSchema,
  orderStatusEnum,
  createProductRequestSchema,
  listProductsPublicResponseSchema,
  productWithVariantsPublicCountSchema,
} from "common/types/store.js";
import { assertAuthenticated } from "api/authenticated.js";

export const STORE_CLIENT_HTTP_CACHE_POLICY = `public, max-age=${STORE_CACHED_DURATION}, stale-while-revalidate=${STORE_CACHED_DURATION * 2}, stale-if-error=${STALE_IF_ERROR_CACHED_TIME}`;

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
        querystring: z.object({
          ts,
        }),
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
    async (request, reply) => {
      const ts = request.query?.ts;
      if (ts) {
        try {
          await fastify.authorize(request, reply, [], false);
        } catch {
          throw new UnauthenticatedError({
            message: "You must be authenticated to specify a staleness bound.",
          });
        }
      } else {
        reply.header("Cache-Control", STORE_CLIENT_HTTP_CACHE_POLICY);
      }
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
        querystring: z.object({
          ts,
        }),
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
      const ts = request.query?.ts;
      if (ts) {
        try {
          await fastify.authorize(request, reply, [], false);
        } catch {
          throw new UnauthenticatedError({
            message: "You must be authenticated to specify a staleness bound.",
          });
        }
      } else {
        reply.header("Cache-Control", STORE_CLIENT_HTTP_CACHE_POLICY);
      }
      const product = await getProduct({
        productId: request.params.productId,
        dynamoClient: fastify.dynamoClient,
      });
      return reply
        .header("Cache-Control", STORE_CLIENT_HTTP_CACHE_POLICY)
        .send(product);
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

  // Create a product - Admin only
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/admin/products",
    {
      schema: withRoles(
        [AppRoles.STORE_MANAGER],
        withTags(["Store"], {
          summary: "Create a new product with variants.",
          body: createProductRequestSchema.refine(
            (data) =>
              !data.openAt || !data.closeAt || data.openAt < data.closeAt,
            { message: "openAt must be before closeAt" },
          ),
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
        actor: request.username,
      });

      return reply.status(201).send({
        success: true,
        productId: request.body.productId,
      });
    }),
  );

  // Get all orders (admin) with optional filters
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/admin/orders/:productId",
    {
      schema: withRoles(
        [AppRoles.STORE_MANAGER, AppRoles.STORE_FULFILLMENT],
        withTags(["Store"], {
          summary: "List all orders for a given product.",
          querystring: z.object({
            status: orderStatusEnum.optional(),
          }),
          params: z.object({
            productId: z.string().min(1),
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
      const orders = await listProductOrders({
        dynamoClient: fastify.dynamoClient,
        status: request.query.status,
        productId: request.params.productId,
      });
      return reply.send({ orders });
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

          await processStorePaymentSuccess({
            orderId,
            userId,
            paymentIntentId,
            dynamoClient: fastify.dynamoClient,
            stripeApiKey: fastify.secretConfig.stripe_secret_key as string,
            logger: request.log,
          });

          return reply.status(200).send({
            handled: true,
            requestId: request.id,
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
