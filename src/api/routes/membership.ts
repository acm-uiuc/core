import {
  checkPaidMembershipFromEntra,
  checkPaidMembershipFromTable,
  setPaidMembershipInTable,
} from "api/functions/membership.js";
import { validateNetId } from "api/functions/validation.js";
import { FastifyPluginAsync } from "fastify";
import {
  BaseError,
  InternalServerError,
  UnauthenticatedError,
  ValidationError,
} from "common/errors/index.js";
import { getEntraIdToken } from "api/functions/entraId.js";
import { genericConfig, roleArns } from "common/config.js";
import { getRoleCredentials } from "api/functions/sts.js";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import rateLimiter from "api/plugins/rateLimiter.js";
import { createCheckoutSession } from "api/functions/stripe.js";
import { getSecretValue } from "api/plugins/auth.js";
import stripe, { Stripe } from "stripe";
import { AvailableSQSFunctions, SQSPayload } from "common/types/sqsMessage.js";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

const NONMEMBER_CACHE_SECONDS = 1800; // 30 minutes
const MEMBER_CACHE_SECONDS = 43200; // 12 hours

const membershipPlugin: FastifyPluginAsync = async (fastify, _options) => {
  const getAuthorizedClients = async () => {
    if (roleArns.Entra) {
      fastify.log.info(
        `Attempting to assume Entra role ${roleArns.Entra} to get the Entra token...`,
      );
      const credentials = await getRoleCredentials(roleArns.Entra);
      const clients = {
        smClient: new SecretsManagerClient({
          region: genericConfig.AwsRegion,
          credentials,
        }),
        dynamoClient: new DynamoDBClient({
          region: genericConfig.AwsRegion,
          credentials,
        }),
      };
      fastify.log.info(
        `Assumed Entra role ${roleArns.Entra} to get the Entra token.`,
      );
      return clients;
    } else {
      fastify.log.debug(
        "Did not assume Entra role as no env variable was present",
      );
      return {
        smClient: fastify.secretsManagerClient,
        dynamoClient: fastify.dynamoClient,
      };
    }
  };
  const limitedRoutes: FastifyPluginAsync = async (fastify) => {
    await fastify.register(rateLimiter, {
      limit: 20,
      duration: 30,
      rateLimitIdentifier: "membership",
    });
    fastify.get<{
      Body: undefined;
      Querystring: { netId: string };
    }>("/checkout/:netId", async (request, reply) => {
      const netId = (request.params as Record<string, string>).netId;
      if (!validateNetId(netId)) {
        throw new ValidationError({
          message: `${netId} is not a valid Illinois NetID!`,
        });
      }
      if (fastify.nodeCache.get(`isMember_${netId}`) === true) {
        throw new ValidationError({
          message: `${netId} is already a paid member!`,
        });
      }
      const isDynamoMember = await checkPaidMembershipFromTable(
        netId,
        fastify.dynamoClient,
      );
      if (isDynamoMember) {
        fastify.nodeCache.set(`isMember_${netId}`, true, MEMBER_CACHE_SECONDS);
        throw new ValidationError({
          message: `${netId} is already a paid member!`,
        });
      }
      const entraIdToken = await getEntraIdToken(
        await getAuthorizedClients(),
        fastify.environmentConfig.AadValidClientId,
      );
      const paidMemberGroup = fastify.environmentConfig.PaidMemberGroupId;
      const isAadMember = await checkPaidMembershipFromEntra(
        netId,
        entraIdToken,
        paidMemberGroup,
      );
      if (isAadMember) {
        fastify.nodeCache.set(`isMember_${netId}`, true, MEMBER_CACHE_SECONDS);
        reply
          .header("X-ACM-Data-Source", "aad")
          .send({ netId, isPaidMember: true });
        await setPaidMembershipInTable(netId, fastify.dynamoClient);
        throw new ValidationError({
          message: `${netId} is already a paid member!`,
        });
      }
      fastify.nodeCache.set(
        `isMember_${netId}`,
        false,
        NONMEMBER_CACHE_SECONDS,
      );
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
      return reply.status(200).send(
        await createCheckoutSession({
          successUrl: "https://acm.illinois.edu/paid",
          returnUrl: "https://acm.illinois.edu/membership",
          customerEmail: `${netId}@illinois.edu`,
          stripeApiKey: secretApiConfig.stripe_secret_key as string,
          items: [
            { price: fastify.environmentConfig.PaidMemberPriceId, quantity: 1 },
          ],
          initiator: "purchase-membership",
        }),
      );
    });
    fastify.get<{
      Body: undefined;
      Querystring: { netId: string };
    }>("/:netId", async (request, reply) => {
      const netId = (request.params as Record<string, string>).netId;
      if (!validateNetId(netId)) {
        throw new ValidationError({
          message: `${netId} is not a valid Illinois NetID!`,
        });
      }
      if (fastify.nodeCache.get(`isMember_${netId}`) !== undefined) {
        return reply.header("X-ACM-Data-Source", "cache").send({
          netId,
          isPaidMember: fastify.nodeCache.get(`isMember_${netId}`),
        });
      }
      const isDynamoMember = await checkPaidMembershipFromTable(
        netId,
        fastify.dynamoClient,
      );
      if (isDynamoMember) {
        fastify.nodeCache.set(`isMember_${netId}`, true, MEMBER_CACHE_SECONDS);
        return reply
          .header("X-ACM-Data-Source", "dynamo")
          .send({ netId, isPaidMember: true });
      }
      const entraIdToken = await getEntraIdToken(
        await getAuthorizedClients(),
        fastify.environmentConfig.AadValidClientId,
      );
      const paidMemberGroup = fastify.environmentConfig.PaidMemberGroupId;
      const isAadMember = await checkPaidMembershipFromEntra(
        netId,
        entraIdToken,
        paidMemberGroup,
      );
      if (isAadMember) {
        fastify.nodeCache.set(`isMember_${netId}`, true, MEMBER_CACHE_SECONDS);
        reply
          .header("X-ACM-Data-Source", "aad")
          .send({ netId, isPaidMember: true });
        await setPaidMembershipInTable(netId, fastify.dynamoClient);
        return;
      }
      fastify.nodeCache.set(
        `isMember_${netId}`,
        false,
        NONMEMBER_CACHE_SECONDS,
      );
      return reply
        .header("X-ACM-Data-Source", "aad")
        .send({ netId, isPaidMember: false });
    });
  };

  fastify.post(
    "/provision",
    {
      preParsing: async (request, _reply, payload) => {
        try {
          const sig = request.headers["stripe-signature"];
          if (!sig || typeof sig !== "string") {
            throw new Error("Missing or invalid Stripe signature");
          }

          if (!Buffer.isBuffer(payload) && typeof payload !== "string") {
            throw new Error("Invalid payload format");
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
          stripe.webhooks.constructEvent(
            payload.toString(),
            sig,
            secretApiConfig.stripe_endpoint_secret as string,
          );
        } catch (err: unknown) {
          if (err instanceof BaseError) {
            throw err;
          }
          throw new UnauthenticatedError({
            message: "Stripe webhook could not be validated.",
          });
        }
      },
    },
    async (request, reply) => {
      const event = request.body as Stripe.Event;
      switch (event.type) {
        case "checkout.session.completed":
          if (
            event.data.object.metadata &&
            "initiator" in event.data.object.metadata &&
            event.data.object.metadata["initiator"] == "purchase-membership"
          ) {
            const customerEmail = event.data.object.customer_email;
            if (!customerEmail) {
              return reply
                .code(200)
                .send({ handled: false, requestId: request.id });
            }
            const sqsPayload: SQSPayload<AvailableSQSFunctions.ProvisionNewMember> =
              {
                function: AvailableSQSFunctions.ProvisionNewMember,
                metadata: {
                  initiator: event.data.object.id,
                  reqId: request.id,
                },
                payload: {
                  email: customerEmail,
                },
              };
            if (!fastify.sqsClient) {
              fastify.sqsClient = new SQSClient({
                region: genericConfig.AwsRegion,
              });
            }
            const result = await fastify.sqsClient.send(
              new SendMessageCommand({
                QueueUrl: fastify.environmentConfig.SqsQueueUrl,
                MessageBody: JSON.stringify(sqsPayload),
              }),
            );
            if (!result.MessageId) {
              request.log.error(result);
              throw new InternalServerError({
                message: "Could not add job to queue.",
              });
            }
            return reply.status(200).send({
              handled: true,
              requestId: request.id,
              queueId: result.MessageId,
            });
          } else {
            return reply
              .code(200)
              .send({ handled: false, requestId: request.id });
          }
        default:
          request.log.warn(`Unhandled event type: ${event.type}`);
      }
      return reply.code(200).send({ handled: false, requestId: request.id });
    },
  );
  fastify.register(limitedRoutes);
};

export default membershipPlugin;
