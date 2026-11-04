import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
  PutItemCommand,
  TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { withRoles, withTags } from "api/components/index.js";
import { buildAuditLogTransactPut } from "api/functions/auditLog.js";
import {
  createStripeLink,
  deactivateStripeLink,
  deactivateStripeProduct,
  getPaymentMethodDescriptionString,
  getPaymentMethodForPaymentIntent,
  getStripeAccountIdentity,
  StripeLinkCreateParams,
  SupportedStripePaymentMethod,
  supportedStripePaymentMethods,
  deactivatePaidStripeLink,
  enqueueSubscriberCallback,
  notifyLinkOwner,
} from "api/functions/stripe.js";
import {
  listEligibleRampFunds,
  resolveRampIdentity,
  validateRampTarget,
} from "api/functions/ramp/client.js";
import {
  enqueueStripeLinkSettlement,
  getStripeLinkRoute,
  recordStripeLinkPayment,
} from "api/functions/ramp/records.js";
import { processStripeLinkSettlement } from "api/functions/ramp/settlement.js";
import { getSecretValue } from "api/plugins/auth.js";
import { genericConfig, notificationRecipients } from "common/config.js";
import {
  BaseError,
  DatabaseDeleteError,
  DatabaseFetchError,
  DatabaseInsertError,
  InternalServerError,
  NotFoundError,
  ResourceConflictError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
} from "common/errors/index.js";
import { Modules } from "common/modules.js";
import { AppRoles } from "common/roles.js";
import {
  invoiceLinkGetResponseSchema,
  invoiceLinkPostRequestSchema,
  invoiceLinkPostResponseSchema,
  callbackRegistrationGetResponseSchema,
  callbackRegistrationPostRequestSchema,
  callbackRegistrationSchema,
  rampFundsResponseSchema,
  RampTarget,
} from "common/types/stripe.js";
import { FastifyPluginAsync, FastifyRequest } from "fastify";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import stripe, { Stripe } from "stripe";
import rawbody from "fastify-raw-body";
import { SQSClient } from "@aws-sdk/client-sqs";
import * as z from "zod/v4";
import {
  STRIPE_CALLBACK_REGISTRATION_PARTITION,
  STRIPE_LINK_RETENTION_DAYS,
  STRIPE_LINK_RETENTION_DAYS_QA,
} from "common/constants.js";
import { assertAuthenticated } from "api/authenticated.js";
import { isConditionalCheckFailed } from "api/utils.js";
import { maxLength } from "common/types/generic.js";
import { randomBytes } from "crypto";

// Targeted link/audit/route creation and settlement must share the primary
// region (DynamoDB transactions cannot span regions) and avoid blind retries.
const settlementDynamoClient = new DynamoDBClient({
  region: "us-east-2",
  maxAttempts: 1,
});

const formatCurrency = (amount: number, currency: string): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  })
    .formatToParts(amount / 100)
    .map((val) => val.value)
    .join("");

const remoteDeadlineFor = (request: FastifyRequest): number => {
  const now = Date.now();
  const remaining = request.awsLambda?.context.getRemainingTimeInMillis?.();
  return Math.min(
    now + 12_000,
    remaining === undefined ? now + 12_000 : now + remaining - 5_000,
  );
};

const stripeRequestOptions = (deadline: number): Stripe.RequestOptions => {
  const timeout = deadline - Date.now();
  if (timeout <= 0) {
    throw new Error("Stripe remote deadline exhausted.");
  }
  return { timeout, maxNetworkRetries: 0 };
};

const resolvePaymentMethodString = async ({
  stripeClient,
  stripeApiKey,
  paymentIntentId,
  deadline,
}: {
  stripeClient: Stripe;
  stripeApiKey: string;
  paymentIntentId: string;
  deadline: number;
}): Promise<string | null> => {
  const paymentMethodData = await getPaymentMethodForPaymentIntent({
    paymentIntentId,
    stripeApiKey,
    stripeClient,
    requestOptions: stripeRequestOptions(deadline),
  });
  const paymentMethodType =
    paymentMethodData.type as SupportedStripePaymentMethod;
  if (!supportedStripePaymentMethods.includes(paymentMethodType)) {
    throw new InternalServerError({
      internalLog: `Unknown payment method type ${paymentMethodData.type}!`,
    });
  }
  const paymentMethodDescriptionData = paymentMethodData[paymentMethodType];
  if (!paymentMethodDescriptionData) {
    throw new InternalServerError({
      internalLog: `No payment method data for ${paymentMethodData.type}!`,
    });
  }
  return (
    getPaymentMethodDescriptionString({
      paymentMethod: paymentMethodData,
      paymentMethodType,
    }) ?? null
  );
};

const stripeRoutes: FastifyPluginAsync = async (fastify, _options) => {
  await fastify.register(rawbody, {
    field: "rawBody",
    global: false,
    runFirst: true,
  });
  const getSqsClient = (): SQSClient => {
    if (!fastify.sqsClient) {
      fastify.sqsClient = new SQSClient({ region: genericConfig.AwsRegion });
    }
    return fastify.sqsClient;
  };
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/paymentLinks",
    {
      schema: withRoles(
        [AppRoles.STRIPE_LINK_CREATOR],
        withTags(["Stripe"], {
          summary: "Get available Stripe payment links.",
          response: {
            201: {
              description: "Links retrieved successfully.",
              content: {
                "application/json": {
                  schema: invoiceLinkGetResponseSchema,
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      let dynamoCommand;
      if (request.userRoles?.has(AppRoles.STRIPE_LINK_ADMIN)) {
        dynamoCommand = new ScanCommand({
          TableName: genericConfig.StripeLinksDynamoTableName,
          // Callback registrations share this table under their own partition.
          FilterExpression: "userId <> :callbackPartition",
          ExpressionAttributeValues: {
            ":callbackPartition": { S: STRIPE_CALLBACK_REGISTRATION_PARTITION },
          },
        });
      } else {
        dynamoCommand = new QueryCommand({
          TableName: genericConfig.StripeLinksDynamoTableName,
          KeyConditionExpression: "userId = :userId",
          ExpressionAttributeValues: {
            ":userId": { S: request.username },
          },
        });
      }
      let result;
      try {
        result = await fastify.dynamoClient.send(dynamoCommand);
      } catch (e) {
        if (e instanceof BaseError) {
          throw e;
        }
        request.log.error(e);
        throw new DatabaseFetchError({
          message: "Could not get active links.",
        });
      }

      if (result.Count === 0 || !result.Items) {
        return [];
      }
      const parsed = result.Items.map((item) => unmarshall(item)).map(
        (item) => ({
          id: item.linkId,
          userId: item.userId,
          link: item.url,
          active: item.active,
          invoiceId: item.invoiceId,
          invoiceAmountUsd: item.amount,
          createdAt: item.createdAt || null,
          callbackUrl: item.callbackUrl || undefined,
          rampFund: item.rampFund || undefined,
        }),
      );
      reply.status(200).send(parsed);
    }),
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/rampFunds",
    {
      schema: withRoles(
        [AppRoles.STRIPE_LINK_CREATOR],
        withTags(["Stripe"], {
          summary: "List Ramp funds eligible as invoice payment destinations.",
          response: {
            200: {
              description: "Eligible Ramp funds retrieved.",
              content: {
                "application/json": {
                  schema: rampFundsResponseSchema,
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      const secretConfig = fastify.secretConfig;
      const context = {
        secretConfig,
        environmentConfig: fastify.environmentConfig,
        dynamoClient: fastify.dynamoClient,
        deadline: remoteDeadlineFor(request),
      };
      try {
        const identity = await resolveRampIdentity({
          context,
          tokenPayload: request.tokenPayload,
        });
        if (!identity) {
          reply.status(200).send({ status: "not_linked", funds: [] });
          return;
        }
        const funds = await listEligibleRampFunds({ context, identity });
        reply.status(200).send({ status: "connected", funds });
      } catch (error) {
        if (
          error instanceof ServiceUnavailableError &&
          (!secretConfig.ramp_client_id || !secretConfig.ramp_client_secret)
        ) {
          reply.status(200).send({ status: "unavailable", funds: [] });
          return;
        }
        throw error;
      }
    }),
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/paymentLinks",
    {
      schema: withRoles(
        [AppRoles.STRIPE_LINK_CREATOR],
        withTags(["Stripe"], {
          summary: "Create a Stripe payment link.",
          body: invoiceLinkPostRequestSchema,
          response: {
            201: {
              description: "Link created successfully.",
              content: {
                "application/json": {
                  schema: invoiceLinkPostResponseSchema,
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      if (request.body.callbackUrl) {
        const { origin } = new URL(request.body.callbackUrl);
        const registration = await fastify.dynamoClient.send(
          new GetItemCommand({
            TableName: genericConfig.StripeLinksDynamoTableName,
            Key: {
              userId: { S: STRIPE_CALLBACK_REGISTRATION_PARTITION },
              linkId: { S: origin },
            },
          }),
        );
        if (!registration.Item) {
          throw new ValidationError({
            message: `Callback origin ${origin} is not registered. Register it with POST /api/v1/stripe/paymentLinks/callback first.`,
          });
        }
      }
      const secretApiConfig = fastify.secretConfig;
      const remoteDeadline = remoteDeadlineFor(request);

      let rampTarget: RampTarget | undefined;
      let rampFund: { id: string; displayName: string } | undefined;

      if (request.body.rampFundId) {
        if (!request.tokenPayload) {
          throw new UnauthorizedError({
            message:
              "Ramp fund selection requires an Entra-authenticated user.",
          });
        }
        const context = {
          secretConfig: secretApiConfig,
          environmentConfig: fastify.environmentConfig,
          dynamoClient: fastify.dynamoClient,
          deadline: remoteDeadline,
        };
        const identity = await resolveRampIdentity({
          context,
          tokenPayload: request.tokenPayload,
        });
        if (!identity) {
          throw new UnauthorizedError({
            message: "No Ramp account is linked for this user.",
          });
        }
        const funds = await listEligibleRampFunds({ context, identity });
        const selected = funds.find(
          (fund) => fund.id === request.body.rampFundId,
        );
        if (!selected) {
          throw new ValidationError({
            message: "The selected Ramp fund is no longer available.",
          });
        }
        const pinnedTarget: RampTarget = {
          namespace: identity.namespace,
          businessId: identity.businessId,
          fundId: selected.id,
          fundName: selected.displayName,
          rampUserId: identity.rampUserId,
          creatorTenantId: identity.creatorTenantId,
          creatorObjectId: identity.creatorObjectId,
        };
        const validation = await validateRampTarget({
          context,
          target: pinnedTarget,
        });
        if (validation.status === "access_revoked") {
          throw new UnauthorizedError({
            message: "You no longer have permission to manage this Ramp fund.",
          });
        }
        if (validation.status !== "eligible") {
          throw new ValidationError({
            message:
              "The selected Ramp fund is no longer an eligible destination.",
          });
        }
        rampTarget = { ...pinnedTarget, fundName: validation.displayName };
        rampFund = { id: selected.id, displayName: validation.displayName };
      }

      const stripeClient = rampTarget
        ? new Stripe(secretApiConfig.stripe_secret_key as string, {
            maxNetworkRetries: 0,
          })
        : undefined;
      const payload: StripeLinkCreateParams = {
        ...request.body,
        createdBy: request.username,
        stripeApiKey: secretApiConfig.stripe_secret_key as string,
        statementDescriptorSuffix: maxLength("INVOICE", 7),
        delayedSettlementAllowed: true,
        ...(stripeClient ? { stripeClient, deadline: remoteDeadline } : {}),
      };
      const { url, linkId, priceId, productId } =
        await createStripeLink(payload);

      let livemode = fastify.runEnvironment === "prod";
      let stripeAccountId: string | undefined;
      if (rampTarget) {
        const retrievedLink = await stripeClient!.paymentLinks.retrieve(
          linkId,
          undefined,
          stripeRequestOptions(remoteDeadline),
        );
        livemode = retrievedLink.livemode;
        if (livemode !== (fastify.runEnvironment === "prod")) {
          await deactivateStripeLink({
            stripeApiKey: secretApiConfig.stripe_secret_key as string,
            linkId,
          });
          throw new ResourceConflictError({
            message:
              "Stripe payment link mode does not match this environment.",
          });
        }
        stripeAccountId = await getStripeAccountIdentity({
          stripeClient: stripeClient!,
          stripeApiKey: secretApiConfig.stripe_secret_key as string,
          dynamoClient: fastify.dynamoClient,
          deadline: remoteDeadline,
        });
      }

      const invoiceId = request.body.invoiceId;
      const callbackUrl = request.body.callbackUrl;
      const signingSecret = callbackUrl
        ? randomBytes(32).toString("hex")
        : undefined;
      const createdAt = new Date().toISOString();
      const logStatement = buildAuditLogTransactPut({
        entry: {
          module: Modules.STRIPE,
          actor: request.username,
          target: `Link ${linkId} | Invoice ${invoiceId}`,
          message: callbackUrl
            ? "Created Stripe payment link with subscriber callback"
            : "Created Stripe payment link",
        },
      });
      const linkItem = marshall(
        {
          userId: request.username,
          linkId,
          priceId,
          productId,
          invoiceId,
          url,
          amount: request.body.invoiceAmountUsd,
          active: true,
          createdAt,
          callbackUrl,
          signingSecret,
          ...(rampFund ? { rampFund } : {}),
        },
        { removeUndefinedValues: true },
      );
      const transactItems: TransactWriteItem[] = [
        ...(logStatement ? [logStatement] : []),
        {
          Put: {
            TableName: genericConfig.StripeLinksDynamoTableName,
            Item: linkItem,
          },
        },
      ];
      if (rampTarget) {
        transactItems.push({
          Put: {
            TableName: genericConfig.StripePaymentsDynamoTableName,
            Item: marshall(
              {
                primaryKey: "STRIPE_LINK_ROUTE",
                sortKey: linkId,
                linkId,
                userId: request.username,
                invoiceId,
                amount: request.body.invoiceAmountUsd,
                ...(priceId ? { priceId } : {}),
                ...(productId ? { productId } : {}),
                url,
                createdAt,
                ...(callbackUrl ? { callbackUrl } : {}),
                ...(signingSecret ? { signingSecret } : {}),
                target: rampTarget,
                stripeAccountId: stripeAccountId as string,
                livemode,
              },
              { removeUndefinedValues: true },
            ),
            ConditionExpression:
              "attribute_not_exists(primaryKey) AND attribute_not_exists(sortKey)",
          },
        });
      }
      const dynamoCommand = new TransactWriteItemsCommand({
        TransactItems: transactItems,
      });
      const dynamoClientForWrite = rampTarget
        ? settlementDynamoClient
        : fastify.dynamoClient;
      try {
        await dynamoClientForWrite.send(dynamoCommand);
      } catch (e) {
        if (
          rampTarget &&
          !isConditionalCheckFailed(e) &&
          !(e instanceof Error && e.name === "TransactionCanceledException")
        ) {
          // Ambiguous transaction response: strong-read the immutable route
          // instead of blindly rolling back or overwriting.
          const committed = await getStripeLinkRoute({
            dynamoClient: settlementDynamoClient,
            linkId,
          });
          if (committed) {
            reply.status(201).send({
              id: linkId,
              link: url,
              ...(signingSecret ? { signingSecret } : {}),
            });
            return;
          }
        }
        await deactivateStripeLink({
          stripeApiKey: secretApiConfig.stripe_secret_key as string,
          linkId,
        });
        fastify.log.info(
          `Deactivated Stripe link ${linkId} due to error in writing to database.`,
        );
        if (e instanceof BaseError) {
          throw e;
        }
        fastify.log.error(e);
        throw new DatabaseInsertError({
          message: "Could not write Stripe link to database.",
        });
      }
      reply.status(201).send({
        id: linkId,
        link: url,
        ...(signingSecret ? { signingSecret } : {}),
      });
    }),
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/paymentLinks/callback",
    {
      schema: withRoles(
        [AppRoles.STRIPE_LINK_ADMIN],
        withTags(["Stripe"], {
          summary: "Get registered Stripe payment link callback URLs.",
          response: {
            200: {
              description: "Callback registrations retrieved successfully.",
              content: {
                "application/json": {
                  schema: callbackRegistrationGetResponseSchema,
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      let result;
      try {
        result = await fastify.dynamoClient.send(
          new QueryCommand({
            TableName: genericConfig.StripeLinksDynamoTableName,
            KeyConditionExpression: "userId = :callbackPartition",
            ExpressionAttributeValues: {
              ":callbackPartition": {
                S: STRIPE_CALLBACK_REGISTRATION_PARTITION,
              },
            },
          }),
        );
      } catch (e) {
        if (e instanceof BaseError) {
          throw e;
        }
        request.log.error(e);
        throw new DatabaseFetchError({
          message: "Could not get callback registrations.",
        });
      }
      const parsed = (result.Items || [])
        .map((item) => unmarshall(item))
        .map((item) => ({
          origin: item.linkId,
          description: item.description,
          createdBy: item.createdBy,
          createdAt: item.createdAt || null,
        }));
      reply.status(200).send(parsed);
    }),
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/paymentLinks/callback",
    {
      schema: withRoles(
        [AppRoles.LINKS_MANAGER],
        withTags(["Stripe"], {
          summary: "Register a callback URL for Stripe payment links.",
          body: callbackRegistrationPostRequestSchema,
          response: {
            201: {
              description: "Callback URL registered successfully.",
              content: {
                "application/json": {
                  schema: callbackRegistrationSchema,
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      const { callbackUrl, description } = request.body;
      const { origin } = new URL(callbackUrl);
      const createdAt = new Date().toISOString();
      const logStatement = buildAuditLogTransactPut({
        entry: {
          module: Modules.STRIPE,
          actor: request.username,
          target: origin,
          message: "Registered payment link callback origin",
        },
      });
      try {
        await fastify.dynamoClient.send(
          new TransactWriteItemsCommand({
            TransactItems: [
              ...(logStatement ? [logStatement] : []),
              {
                Put: {
                  TableName: genericConfig.StripeLinksDynamoTableName,
                  Item: marshall({
                    userId: STRIPE_CALLBACK_REGISTRATION_PARTITION,
                    linkId: origin,
                    description,
                    createdBy: request.username,
                    createdAt,
                  }),
                },
              },
            ],
          }),
        );
      } catch (e) {
        if (e instanceof BaseError) {
          throw e;
        }
        request.log.error(e);
        throw new DatabaseInsertError({
          message: "Could not register callback origin.",
        });
      }
      reply.status(201).send({
        origin,
        description,
        createdBy: request.username,
        createdAt,
      });
    }),
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().delete(
    "/paymentLinks/callback/:origin",
    {
      schema: withRoles(
        [AppRoles.STRIPE_LINK_ADMIN],
        withTags(["Stripe"], {
          summary: "Deregister a callback URL for Stripe payment links.",
          description:
            "Payment links already created against this origin keep delivering callbacks; only new links are affected.",
          params: z.object({
            origin: z.string().min(1).meta({
              description: "URL-encoded origin to deregister.",
              example: "https://abc123.lambda-url.us-east-2.on.aws",
            }),
          }),
          response: {
            204: {
              description: "Callback origin deregistered successfully.",
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
      const { origin } = request.params;
      const logStatement = buildAuditLogTransactPut({
        entry: {
          module: Modules.STRIPE,
          actor: request.username,
          target: origin,
          message: "Deregistered payment link callback origin",
        },
      });
      try {
        await fastify.dynamoClient.send(
          new TransactWriteItemsCommand({
            TransactItems: [
              ...(logStatement ? [logStatement] : []),
              {
                Delete: {
                  TableName: genericConfig.StripeLinksDynamoTableName,
                  Key: {
                    userId: { S: STRIPE_CALLBACK_REGISTRATION_PARTITION },
                    linkId: { S: origin },
                  },
                  // Fail rather than report success for an origin that was
                  // never registered.
                  ConditionExpression: "attribute_exists(linkId)",
                },
              },
            ],
          }),
        );
      } catch (e) {
        if (e instanceof BaseError) {
          throw e;
        }
        if (
          e instanceof Error &&
          e.name === "TransactionCanceledException" &&
          e.message.includes("ConditionalCheckFailed")
        ) {
          throw new NotFoundError({ endpointName: request.url });
        }
        request.log.error(e);
        throw new DatabaseDeleteError({
          message: "Could not deregister callback origin.",
        });
      }
      return reply.status(204).send();
    }),
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().delete(
    "/paymentLinks/:linkId",
    {
      schema: withRoles(
        [AppRoles.STRIPE_LINK_CREATOR],
        withTags(["Stripe"], {
          summary: "Deactivate a Stripe payment link.",
          params: z.object({
            linkId: z.string().min(1).meta({
              description: "Payment Link ID",
              example: "plink_abc123",
            }),
          }),
          response: {
            204: {
              description: "Payment link deleted successfully.",
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
      const { linkId } = request.params;
      const response = await fastify.dynamoClient.send(
        new QueryCommand({
          TableName: genericConfig.StripeLinksDynamoTableName,
          IndexName: "LinkIdIndex",
          KeyConditionExpression: "linkId = :linkId",
          ExpressionAttributeValues: {
            ":linkId": { S: linkId },
          },
        }),
      );
      if (!response) {
        throw new DatabaseFetchError({
          message: "Could not check for payment link in table.",
        });
      }
      if (!response.Items || response.Items?.length !== 1) {
        throw new NotFoundError({ endpointName: request.url });
      }
      const unmarshalledEntry = unmarshall(response.Items[0]) as {
        userId: string;
        invoiceId: string;
        amount?: number;
        priceId?: string;
        productId?: string;
        callbackUrl?: string;
        signingSecret?: string;
      };
      if (unmarshalledEntry.userId === STRIPE_CALLBACK_REGISTRATION_PARTITION) {
        // A callback registration shares this table but is not a payment link.
        throw new NotFoundError({ endpointName: request.url });
      }
      if (
        unmarshalledEntry.userId !== request.username &&
        !request.userRoles?.has(AppRoles.STRIPE_LINK_ADMIN)
      ) {
        throw new UnauthorizedError({
          message: "Not authorized to deactivate this payment link.",
        });
      }
      const logStatement = buildAuditLogTransactPut({
        entry: {
          module: Modules.STRIPE,
          actor: request.username,
          target: `Link ${linkId} | Invoice ${unmarshalledEntry.invoiceId}`,
          message: "Deactivated Stripe payment link",
        },
      });
      // expire deleted links
      const expiresAt =
        Math.floor(Date.now() / 1000) +
        86400 *
          (fastify.runEnvironment === "prod"
            ? STRIPE_LINK_RETENTION_DAYS
            : STRIPE_LINK_RETENTION_DAYS_QA);
      const dynamoCommand = new TransactWriteItemsCommand({
        TransactItems: [
          ...(logStatement ? [logStatement] : []),
          {
            Update: {
              TableName: genericConfig.StripeLinksDynamoTableName,
              Key: {
                userId: { S: unmarshalledEntry.userId },
                linkId: { S: linkId },
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
      const secretApiConfig =
        (await getSecretValue(
          fastify.secretsManagerClient,
          genericConfig.ConfigSecretName,
        )) || {};
      if (unmarshalledEntry.productId) {
        request.log.debug(
          `Deactivating Stripe product ${unmarshalledEntry.productId}`,
        );
        await deactivateStripeProduct({
          stripeApiKey: secretApiConfig.stripe_secret_key as string,
          productId: unmarshalledEntry.productId,
        });
      }
      request.log.debug(`Deactivating Stripe link ${linkId}`);
      await deactivateStripeLink({
        stripeApiKey: secretApiConfig.stripe_secret_key as string,
        linkId,
      });
      await fastify.dynamoClient.send(dynamoCommand);
      return reply.status(204).send();
    }),
  );
  fastify.post(
    "/webhook",
    {
      config: { rawBody: true },
      schema: withTags(["Stripe"], {
        summary:
          "Stripe webhook handler to track when Stripe payment links are used.",
        hide: true,
      }),
    },
    async (request, reply) => {
      let event: Stripe.Event;
      if (!request.rawBody) {
        throw new ValidationError({ message: "Could not get raw body." });
      }
      await fastify.refreshSecretConfig();
      const secretApiConfig = fastify.secretConfig;
      try {
        const sig = request.headers["stripe-signature"];
        if (!sig || typeof sig !== "string") {
          throw new Error("Missing or invalid Stripe signature");
        }
        if (!secretApiConfig) {
          throw new InternalServerError({
            message: "Could not connect to Stripe.",
          });
        }
        event = stripe.webhooks.constructEvent(
          request.rawBody,
          sig,
          (fastify.runEnvironment === "dev" && !request.awsLambda
            ? process.env.STRIPE_LINKS_ENDPOINT_SECRET
            : undefined) ||
            (secretApiConfig.stripe_links_endpoint_secret as string),
        );
      } catch (err: unknown) {
        if (err instanceof BaseError) {
          throw err;
        }
        throw new ValidationError({
          message: "Stripe webhook could not be validated.",
        });
      }
      switch (event.type) {
        case "checkout.session.async_payment_failed":
        case "checkout.session.async_payment_succeeded":
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          const paymentLinkId = session.payment_link?.toString();
          if (!paymentLinkId) {
            return reply
              .code(200)
              .send({ handled: false, requestId: request.id });
          }
          const isFailed =
            event.type === "checkout.session.async_payment_failed";
          const isPaid = !isFailed && session.payment_status === "paid";
          const paymentAmount = session.amount_total;
          const paymentCurrency = session.currency;
          if (!paymentCurrency || !paymentAmount) {
            request.log.info("Missing required fields.");
            return reply
              .code(200)
              .send({ handled: false, requestId: request.id });
          }
          const { email, name } = session.customer_details || {
            email: null,
            name: null,
          };
          const paymentIntentId = session.payment_intent?.toString();
          const eventId = event.id;
          const occurredAt = new Date(event.created * 1000).toISOString();
          const remoteDeadline = remoteDeadlineFor(request);
          const sqsClient = getSqsClient();
          const environmentConfig = fastify.environmentConfig;

          const route = await getStripeLinkRoute({
            dynamoClient: settlementDynamoClient,
            linkId: paymentLinkId,
            deadline: remoteDeadline,
          });

          if (route && isPaid) {
            if (!paymentIntentId) {
              request.log.warn(
                "Could not find payment intent ID in webhook payload!",
              );
              throw new ValidationError({
                message: "No payment intent ID found.",
              });
            }
            const stripeClient = new Stripe(
              secretApiConfig.stripe_secret_key as string,
              { maxNetworkRetries: 0 },
            );
            const stripeAccountId = await getStripeAccountIdentity({
              stripeClient,
              stripeApiKey: secretApiConfig.stripe_secret_key as string,
              dynamoClient: fastify.dynamoClient,
              deadline: remoteDeadline,
            });
            if (event.account && event.account !== stripeAccountId) {
              throw new ResourceConflictError({
                message:
                  "Stripe webhook account does not match this integration.",
              });
            }
            const key = await recordStripeLinkPayment({
              dynamoClient: settlementDynamoClient,
              stripeClient,
              secretConfig: secretApiConfig,
              session,
              eventId,
              occurredAt,
              stripeAccountId,
              livemode: event.livemode,
              deadline: remoteDeadline,
            });
            if (!key) {
              throw new InternalServerError({
                message:
                  "Targeted settlement routing disappeared during payment recording.",
              });
            }
            const metadata = { initiator: eventId, reqId: request.id };
            await enqueueStripeLinkSettlement({
              sqsClient,
              environmentConfig,
              key,
              metadata,
              deadline: remoteDeadline,
            });
            await processStripeLinkSettlement({
              dynamoClient: settlementDynamoClient,
              sqsClient,
              stripeClient,
              secretConfig: secretApiConfig,
              environmentConfig,
              runEnvironment: fastify.runEnvironment,
              key,
              metadata,
              logger: request.log,
              remainingTimeInMillis: request.awsLambda
                ? request.awsLambda.context.getRemainingTimeInMillis.bind(
                    request.awsLambda.context,
                  )
                : undefined,
              remoteDeadline,
            });
            return reply.status(200).send({
              handled: true,
              requestId: request.id,
            });
          }

          let entry: {
            userId: string;
            invoiceId: string;
            amount?: number;
            priceId?: string;
            productId?: string;
            callbackUrl?: string;
            signingSecret?: string;
          };
          if (route) {
            entry = route;
          } else {
            const response = await fastify.dynamoClient.send(
              new QueryCommand({
                TableName: genericConfig.StripeLinksDynamoTableName,
                IndexName: "LinkIdIndex",
                KeyConditionExpression: "linkId = :linkId",
                ExpressionAttributeValues: {
                  ":linkId": { S: paymentLinkId },
                },
              }),
            );
            if (!response || !response.Items || response.Items.length !== 1) {
              return reply.status(isPaid ? 503 : 200).send({
                handled: false,
                requestId: request.id,
              });
            }
            entry = unmarshall(response.Items[0]) as typeof entry;
          }
          if (!entry.userId || !entry.invoiceId) {
            return reply.status(200).send({
              handled: false,
              requestId: request.id,
            });
          }
          const paidInFull = paymentAmount === entry.amount;
          const withCurrency = formatCurrency(paymentAmount, paymentCurrency);
          const stripeApiKey = secretApiConfig.stripe_secret_key as string;
          let queueId;

          if (isFailed) {
            request.log.info(
              `Failed payment of ${withCurrency} by ${name} (${email}) for payment link ${paymentLinkId} invoice ID ${entry.invoiceId}).`,
            );
            queueId = await notifyLinkOwner({
              sqsClient,
              environmentConfig,
              requestLog: request.log,
              requestId: request.id,
              eventId,
              userId: entry.userId,
              subject: `Payment Failed for Invoice ${entry.invoiceId}`,
              content: `
A ${paidInFull ? "full" : "partial"} payment for Invoice ${entry.invoiceId} (${withCurrency} paid by ${name}, ${email}) <b>has failed.</b>

Please ask the payee to try again, perhaps with a different payment method, or contact Officer Board.
                    `,
              deadline: remoteDeadline,
            });
            await enqueueSubscriberCallback({
              sqsClient,
              environmentConfig,
              requestLog: request.log,
              requestId: request.id,
              eventId,
              eventType: "payment.failed",
              linkId: paymentLinkId,
              callbackUrl: entry.callbackUrl,
              invoiceId: entry.invoiceId,
              amount: paymentAmount,
              currency: paymentCurrency,
              paidInFull,
              paymentMethod: null,
              payerName: name,
              payerEmail: email,
              occurredAt,
              deadline: remoteDeadline,
            });
            return reply.status(200).send({
              handled: true,
              requestId: request.id,
              queueId: queueId || "",
            });
          }

          if (!paymentIntentId) {
            request.log.warn(
              "Could not find payment intent ID in webhook payload!",
            );
            throw new ValidationError({
              message: "No payment intent ID found.",
            });
          }
          const stripeClient = new Stripe(stripeApiKey, {
            maxNetworkRetries: 0,
          });
          const paymentMethodString = await resolvePaymentMethodString({
            stripeClient,
            stripeApiKey,
            paymentIntentId,
            deadline: remoteDeadline,
          });

          if (isPaid) {
            request.log.info(
              `Registered payment of ${withCurrency} by ${name} (${email}) for payment link ${paymentLinkId} invoice ID ${entry.invoiceId}). Invoice was paid ${paidInFull ? "in full." : "partially."}`,
            );
            queueId = await notifyLinkOwner({
              sqsClient,
              environmentConfig,
              requestLog: request.log,
              requestId: request.id,
              eventId,
              userId: entry.userId,
              cc: [notificationRecipients[fastify.runEnvironment].Treasurer],
              subject: `Payment received for Invoice ${entry.invoiceId}`,
              content: `
ACM @ UIUC has received ${paidInFull ? "full" : "partial"} payment for Invoice ${entry.invoiceId} (${withCurrency} paid by ${name}, ${email}).

${paymentMethodString ? `\nPayment method: ${paymentMethodString}.\n` : ""}

${paidInFull ? "\nThis invoice should now be considered settled.\n" : ""}
Please contact Officer Board with any questions.`,
              deadline: remoteDeadline,
            });
            await enqueueSubscriberCallback({
              sqsClient,
              environmentConfig,
              requestLog: request.log,
              requestId: request.id,
              eventId,
              eventType: "payment.succeeded",
              linkId: paymentLinkId,
              callbackUrl: entry.callbackUrl,
              invoiceId: entry.invoiceId,
              amount: paymentAmount,
              currency: paymentCurrency,
              paidInFull,
              paymentMethod: paymentMethodString ?? null,
              payerName: name,
              payerEmail: email,
              occurredAt,
              deadline: remoteDeadline,
            });
            if (paidInFull) {
              request.log.debug("Paid in full, disabling link.");
              await deactivatePaidStripeLink({
                dynamoClient: fastify.dynamoClient,
                stripeClient,
                entry: {
                  userId: entry.userId,
                  linkId: paymentLinkId,
                  invoiceId: entry.invoiceId,
                  productId: entry.productId,
                },
                eventId,
                requestLog: request.log,
                deadline: remoteDeadline,
              });
            }
          } else {
            request.log.info(
              `Pending payment of ${withCurrency} by ${name} (${email}) for payment link ${paymentLinkId} invoice ID ${entry.invoiceId}). Invoice was tentatively paid ${paidInFull ? "in full." : "partially."}`,
            );
            queueId = await notifyLinkOwner({
              sqsClient,
              environmentConfig,
              requestLog: request.log,
              requestId: request.id,
              eventId,
              userId: entry.userId,
              subject: `Payment Pending for Invoice ${entry.invoiceId}`,
              content: `
ACM @ UIUC has received intent of ${paidInFull ? "full" : "partial"} payment for Invoice ${entry.invoiceId} (${withCurrency} paid by ${name}, ${email}).

The payee has used a payment method which does not settle funds immediately. Therefore, ACM @ UIUC is still waiting for funds to settle and <b>no services should be performed until the funds settle.</b>

Please contact Officer Board with any questions.
                    `,
              deadline: remoteDeadline,
            });
            await enqueueSubscriberCallback({
              sqsClient,
              environmentConfig,
              requestLog: request.log,
              requestId: request.id,
              eventId,
              eventType: "payment.pending",
              linkId: paymentLinkId,
              callbackUrl: entry.callbackUrl,
              invoiceId: entry.invoiceId,
              amount: paymentAmount,
              currency: paymentCurrency,
              paidInFull,
              paymentMethod: paymentMethodString ?? null,
              payerName: name,
              payerEmail: email,
              occurredAt,
              deadline: remoteDeadline,
            });
          }
          return reply.status(200).send({
            handled: true,
            requestId: request.id,
            queueId: queueId || "",
          });
        }
        case "payment_intent.succeeded": {
          const intent = event.data.object as Stripe.PaymentIntent;

          const amount = intent.amount_received;
          const currency = intent.currency;
          const customerId = intent.customer?.toString();
          const email = intent.receipt_email ?? intent.metadata?.billing_email;
          const acmOrg = intent.metadata?.acm_org;

          if (!customerId) {
            request.log.info("Skipping payment intent with no customer ID.");
            return reply
              .code(200)
              .send({ handled: false, requestId: request.id });
          }

          if (!email) {
            request.log.warn("Missing email for payment intent.");
            return reply
              .code(200)
              .send({ handled: false, requestId: request.id });
          }

          if (!acmOrg) {
            request.log.warn("Missing acm_org for payment intent.");
            return reply
              .code(200)
              .send({ handled: false, requestId: request.id });
          }

          const normalizedEmail = email.trim();
          if (!normalizedEmail.includes("@")) {
            request.log.warn("Invalid email format for payment intent.");
            return reply
              .code(200)
              .send({ handled: false, requestId: request.id });
          }
          const [, domainPart] = normalizedEmail.split("@");
          if (!domainPart) {
            request.log.warn(
              "Could not derive email domain for payment intent.",
            );
            return reply
              .code(200)
              .send({ handled: false, requestId: request.id });
          }
          const domain = domainPart.toLowerCase();

          try {
            await fastify.dynamoClient.send(
              new PutItemCommand({
                TableName: genericConfig.StripePaymentsDynamoTableName,
                Item: marshall({
                  primaryKey: `${acmOrg}#${domain}`,
                  sortKey: event.id,
                  amount,
                  currency,
                  status: "succeeded",
                  billingEmail: normalizedEmail,
                  createdAt: new Date().toISOString(),
                  eventId: event.id,
                }),
              }),
            );

            request.log.info(
              `Recorded successful payment ${intent.id} from ${normalizedEmail} (${amount} ${currency})`,
            );

            return reply
              .status(200)
              .send({ handled: true, requestId: request.id });
          } catch (e) {
            if (e instanceof BaseError) {
              throw e;
            }
            request.log.error(e);
            throw new DatabaseInsertError({
              message: `Could not insert Stripe payment record: ${(e as Error).message}`,
            });
          }
        }
        default:
          request.log.warn(`Unhandled event type: ${event.type}`);
      }
      return reply.code(200).send({ handled: false, requestId: request.id });
    },
  );
};

export default stripeRoutes;
