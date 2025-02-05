import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import {
  createStripeLink,
  StripeLinkCreateParams,
} from "api/functions/stripe.js";
import { getSecretValue } from "api/plugins/auth.js";
import { genericConfig } from "common/config.js";
import {
  InternalServerError,
  UnauthenticatedError,
} from "common/errors/index.js";
import { AppRoles } from "common/roles.js";
import {
  invoiceLinkPostResponseSchema,
  invoiceLinkPostRequestSchema,
} from "common/types/stripe.js";
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const stripeRoutes: FastifyPluginAsync = async (fastify, _options) => {
  fastify.post<{ Body: z.infer<typeof invoiceLinkPostRequestSchema> }>(
    "/paymentLink",
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
          url,
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
