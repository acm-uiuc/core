import {
  checkExternalMembership,
  checkPaidMembershipFromEntra,
  checkPaidMembershipFromTable,
  setPaidMembershipInTable,
} from "api/functions/membership.js";
import { validateNetId } from "api/functions/validation.js";
import { FastifyPluginAsync } from "fastify";
import {
  BaseError,
  InternalServerError,
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
import rawbody from "fastify-raw-body";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import { z } from "zod";
import { withTags } from "api/components/index.js";

const NONMEMBER_CACHE_SECONDS = 60; // 1 minute
const MEMBER_CACHE_SECONDS = 43200; // 12 hours

const membershipPlugin: FastifyPluginAsync = async (fastify, _options) => {
  await fastify.register(rawbody, {
    field: "rawBody",
    global: false,
    runFirst: true,
  });
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
    }
    fastify.log.debug(
      "Did not assume Entra role as no env variable was present",
    );
    return {
      smClient: fastify.secretsManagerClient,
      dynamoClient: fastify.dynamoClient,
    };
  };
  const limitedRoutes: FastifyPluginAsync = async (fastify) => {
    await fastify.register(rateLimiter, {
      limit: 20,
      duration: 30,
      rateLimitIdentifier: "membership",
    });
    fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
      "/checkout/:netId",
      {
        schema: withTags(["Membership"], {
          params: z
            .object({ netId: z.string().min(1) })
            .refine((data) => validateNetId(data.netId), {
              message: "NetID is not valid!",
              path: ["netId"],
            }),
          summary:
            "Create a checkout session to purchase an ACM @ UIUC membership.",
        }),
      },
      async (request, reply) => {
        const netId = request.params.netId.toLowerCase();
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
          fastify.nodeCache.set(
            `isMember_${netId}`,
            true,
            MEMBER_CACHE_SECONDS,
          );
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
          fastify.nodeCache.set(
            `isMember_${netId}`,
            true,
            MEMBER_CACHE_SECONDS,
          );
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
              {
                price: fastify.environmentConfig.PaidMemberPriceId,
                quantity: 1,
              },
            ],
            initiator: "purchase-membership",
            allowPromotionCodes: true,
          }),
        );
      },
    );
    fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
      "/:netId",
      {
        schema: withTags(["Membership"], {
          params: z
            .object({ netId: z.string().min(1) })
            .refine((data) => validateNetId(data.netId), {
              message: "NetID is not valid!",
              path: ["netId"],
            }),
          querystring: z.object({
            list: z.string().min(1).optional().openapi({
              description:
                "Membership list to check from (defaults to ACM Paid Member list).",
            }),
          }),
          summary:
            "Check ACM @ UIUC paid membership (or partner organization membership) status.",
        }),
      },
      async (request, reply) => {
        const netId = request.params.netId.toLowerCase();
        const list = request.query.list || "acmpaid";
        if (fastify.nodeCache.get(`isMember_${netId}_${list}`) !== undefined) {
          return reply.header("X-ACM-Data-Source", "cache").send({
            netId,
            list: list === "acmpaid" ? undefined : list,
            isPaidMember: fastify.nodeCache.get(`isMember_${netId}_${list}`),
          });
        }
        if (list !== "acmpaid") {
          const isMember = await checkExternalMembership(
            netId,
            list,
            fastify.dynamoClient,
          );
          fastify.nodeCache.set(
            `isMember_${netId}_${list}`,
            isMember,
            MEMBER_CACHE_SECONDS,
          );
          return reply.header("X-ACM-Data-Source", "dynamo").send({
            netId,
            list,
            isPaidMember: isMember,
          });
        }
        const isDynamoMember = await checkPaidMembershipFromTable(
          netId,
          fastify.dynamoClient,
        );
        if (isDynamoMember) {
          fastify.nodeCache.set(
            `isMember_${netId}_${list}`,
            true,
            MEMBER_CACHE_SECONDS,
          );
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
          fastify.nodeCache.set(
            `isMember_${netId}_${list}`,
            true,
            MEMBER_CACHE_SECONDS,
          );
          reply
            .header("X-ACM-Data-Source", "aad")
            .send({ netId, isPaidMember: true });
          await setPaidMembershipInTable(netId, fastify.dynamoClient);
          return;
        }
        fastify.nodeCache.set(
          `isMember_${netId}_${list}`,
          false,
          NONMEMBER_CACHE_SECONDS,
        );
        return reply
          .header("X-ACM-Data-Source", "aad")
          .send({ netId, isPaidMember: false });
      },
    );
  };
  fastify.post(
    "/provision",
    {
      config: { rawBody: true },
      schema: withTags(["Membership"], {
        summary:
          "Stripe webhook handler to provision ACM @ UIUC membership after checkout session has completed.",
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
        event = stripe.webhooks.constructEvent(
          request.rawBody,
          sig,
          secretApiConfig.stripe_endpoint_secret as string,
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
        case "checkout.session.completed":
          if (
            event.data.object.metadata &&
            "initiator" in event.data.object.metadata &&
            event.data.object.metadata.initiator === "purchase-membership"
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
                  initiator: event.id,
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
          }
          return reply
            .code(200)
            .send({ handled: false, requestId: request.id });

        default:
          request.log.warn(`Unhandled event type: ${event.type}`);
      }
      return reply.code(200).send({ handled: false, requestId: request.id });
    },
  );
  fastify.register(limitedRoutes);
};

export default membershipPlugin;
