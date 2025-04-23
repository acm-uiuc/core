import {
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { withRoles, withTags } from "api/components/index.js";
import {
  buildAuditLogTransactPut,
  createAuditLogEntry,
} from "api/functions/auditLog.js";
import {
  createStripeLink,
  deactivateStripeLink,
  StripeLinkCreateParams,
} from "api/functions/stripe.js";
import { getSecretValue } from "api/plugins/auth.js";
import { genericConfig } from "common/config.js";
import {
  BaseError,
  DatabaseFetchError,
  DatabaseInsertError,
  InternalServerError,
  UnauthenticatedError,
} from "common/errors/index.js";
import { Modules } from "common/modules.js";
import { AppRoles } from "common/roles.js";
import {
  invoiceLinkPostResponseSchema,
  invoiceLinkPostRequestSchema,
  invoiceLinkGetResponseSchema,
} from "common/types/stripe.js";
import { FastifyPluginAsync } from "fastify";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";

const stripeRoutes: FastifyPluginAsync = async (fastify, _options) => {
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/paymentLinks",
    {
      schema: withRoles(
        [AppRoles.STRIPE_LINK_CREATOR],
        withTags(["Stripe"], {
          summary: "Get available Stripe payment links.",
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      let dynamoCommand;
      if (request.userRoles?.has(AppRoles.BYPASS_OBJECT_LEVEL_AUTH)) {
        dynamoCommand = new ScanCommand({
          TableName: genericConfig.StripeLinksDynamoTableName,
        });
      } else {
        dynamoCommand = new QueryCommand({
          TableName: genericConfig.StripeLinksDynamoTableName,
          KeyConditionExpression: "userId = :userId",
          ExpressionAttributeValues: {
            ":userId": { S: request.username! },
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
        }),
      );
      reply.status(200).send(parsed);
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/paymentLinks",
    {
      schema: withRoles(
        [AppRoles.STRIPE_LINK_CREATOR],
        withTags(["Stripe"], {
          summary: "Create a Stripe payment link.",
          body: invoiceLinkPostRequestSchema,
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      if (!request.username) {
        throw new UnauthenticatedError({ message: "No username found" });
      }
      const secretApiConfig =
        (await getSecretValue(
          fastify.secretsManagerClient,
          genericConfig.ConfigSecretName,
        )) || {};
      if (!secretApiConfig) {
        throw new InternalServerError({
          message: "Could not connect to Stripe.",
        });
      }
      const payload: StripeLinkCreateParams = {
        ...request.body,
        createdBy: request.username,
        stripeApiKey: secretApiConfig.stripe_secret_key as string,
      };
      const { url, linkId, priceId, productId } =
        await createStripeLink(payload);
      const invoiceId = request.body.invoiceId;
      const logStatement = buildAuditLogTransactPut({
        entry: {
          module: Modules.STRIPE,
          actor: request.username,
          target: `Link ${linkId} | Invoice ${invoiceId}`,
          message: "Created Stripe payment link",
        },
      });
      const dynamoCommand = new TransactWriteItemsCommand({
        TransactItems: [
          logStatement,
          {
            Put: {
              TableName: genericConfig.StripeLinksDynamoTableName,
              Item: marshall({
                userId: request.username,
                linkId,
                priceId,
                productId,
                invoiceId,
                url,
                amount: request.body.invoiceAmountUsd,
                active: true,
                createdAt: new Date().toISOString(),
              }),
            },
          },
        ],
      });
      try {
        await fastify.dynamoClient.send(dynamoCommand);
      } catch (e) {
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
      reply.status(201).send({ id: linkId, link: url });
    },
  );
};

export default stripeRoutes;
