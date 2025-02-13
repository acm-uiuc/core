import {
  PutItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  createStripeLink,
  StripeLinkCreateParams,
} from "api/functions/stripe.js";
import { getSecretValue } from "api/plugins/auth.js";
import { genericConfig } from "common/config.js";
import {
  BaseError,
  DatabaseFetchError,
  InternalServerError,
  UnauthenticatedError,
} from "common/errors/index.js";
import { AppRoles } from "common/roles.js";
import {
  invoiceLinkPostResponseSchema,
  invoiceLinkPostRequestSchema,
  invoiceLinkGetResponseSchema,
} from "common/types/stripe.js";
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const stripeRoutes: FastifyPluginAsync = async (fastify, _options) => {
  fastify.get(
    "/paymentLinks",
    {
      schema: {
        response: { 200: zodToJsonSchema(invoiceLinkGetResponseSchema) },
      },
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [AppRoles.STRIPE_LINK_CREATOR]);
      },
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
  fastify.post<{ Body: z.infer<typeof invoiceLinkPostRequestSchema> }>(
    "/paymentLinks",
    {
      schema: {
        response: { 201: zodToJsonSchema(invoiceLinkPostResponseSchema) },
      },
      preValidation: async (request, reply) => {
        await fastify.zodValidateBody(
          request,
          reply,
          invoiceLinkPostRequestSchema,
        );
      },
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [AppRoles.STRIPE_LINK_CREATOR]);
      },
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
      const dynamoCommand = new PutItemCommand({
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
      });
      await fastify.dynamoClient.send(dynamoCommand);
      request.log.info(
        {
          type: "audit",
          actor: request.username,
          target: `Link ${linkId} | Invoice ${invoiceId}`,
        },
        "Created Stripe payment link",
      );
      reply.status(201).send({ id: linkId, link: url });
    },
  );
};

export default stripeRoutes;
