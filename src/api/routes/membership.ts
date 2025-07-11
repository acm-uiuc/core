import {
  checkExternalMembership,
  checkPaidMembershipFromEntra,
  checkPaidMembershipFromTable,
  setPaidMembershipInTable,
  MEMBER_CACHE_SECONDS,
} from "api/functions/membership.js";
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
import * as z from "zod/v4";
import { illinoisNetId, withTags } from "api/components/index.js";
import { getKey, setKey } from "api/functions/redisCache.js";

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
        redisClient: fastify.redisClient,
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
      redisClient: fastify.redisClient,
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
          params: z.object({ netId: illinoisNetId }),
          summary:
            "Create a checkout session to purchase an ACM @ UIUC membership.",
        }),
      },
      async (request, reply) => {
        const netId = request.params.netId.toLowerCase();
        const cacheKey = `membership:${netId}:acmpaid`;
        const result = await getKey<{ isMember: boolean }>({
          redisClient: fastify.redisClient,
          key: cacheKey,
          logger: request.log,
        });
        if (result && result.isMember) {
          throw new ValidationError({
            message: `${netId} is already a paid member!`,
          });
        }
        const isDynamoMember = await checkPaidMembershipFromTable(
          netId,
          fastify.dynamoClient,
        );
        if (isDynamoMember) {
          await setKey({
            redisClient: fastify.redisClient,
            key: cacheKey,
            data: JSON.stringify({ isMember: true }),
            expiresIn: MEMBER_CACHE_SECONDS,
            logger: request.log,
          });
          throw new ValidationError({
            message: `${netId} is already a paid member!`,
          });
        }
        const entraIdToken = await getEntraIdToken({
          clients: await getAuthorizedClients(),
          clientId: fastify.environmentConfig.AadValidClientId,
          secretName: genericConfig.EntraSecretName,
          logger: request.log,
        });
        const paidMemberGroup = fastify.environmentConfig.PaidMemberGroupId;
        const isAadMember = await checkPaidMembershipFromEntra(
          netId,
          entraIdToken,
          paidMemberGroup,
        );
        if (isAadMember) {
          await setKey({
            redisClient: fastify.redisClient,
            key: cacheKey,
            data: JSON.stringify({ isMember: true }),
            expiresIn: MEMBER_CACHE_SECONDS,
            logger: request.log,
          });
          reply
            .header("X-ACM-Data-Source", "aad")
            .send({ netId, isPaidMember: true });
          await setPaidMembershipInTable(netId, fastify.dynamoClient);
          throw new ValidationError({
            message: `${netId} is already a paid member!`,
          });
        }
        // Once the caller becomes a member, the stripe webhook will handle changing this to true
        await setKey({
          redisClient: fastify.redisClient,
          key: cacheKey,
          data: JSON.stringify({ isMember: false }),
          expiresIn: MEMBER_CACHE_SECONDS,
          logger: request.log,
        });
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
            customFields: [
              {
                key: "firstName",
                label: {
                  type: "custom",
                  custom: "Member First Name",
                },
                type: "text",
              },
              {
                key: "lastName",
                label: {
                  type: "custom",
                  custom: "Member Last Name",
                },
                type: "text",
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
          params: z.object({ netId: illinoisNetId }),
          querystring: z.object({
            list: z.string().min(1).optional().meta({
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
        // we don't control external list as its direct upload in Dynamo, cache only for 60 seconds.
        const ourCacheSeconds = list === "acmpaid" ? MEMBER_CACHE_SECONDS : 60;
        const cacheKey = `membership:${netId}:${list}`;
        const result = await getKey<{ isMember: boolean }>({
          redisClient: fastify.redisClient,
          key: cacheKey,
          logger: request.log,
        });
        if (result) {
          return reply.header("X-ACM-Data-Source", "cache").send({
            netId,
            list: list === "acmpaid" ? undefined : list,
            isPaidMember: result.isMember,
          });
        }
        if (list !== "acmpaid") {
          const isMember = await checkExternalMembership(
            netId,
            list,
            fastify.dynamoClient,
          );
          await setKey({
            redisClient: fastify.redisClient,
            key: cacheKey,
            data: JSON.stringify({ isMember }),
            expiresIn: ourCacheSeconds,
            logger: request.log,
          });
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
          await setKey({
            redisClient: fastify.redisClient,
            key: cacheKey,
            data: JSON.stringify({ isMember: true }),
            expiresIn: ourCacheSeconds,
            logger: request.log,
          });
          return reply
            .header("X-ACM-Data-Source", "dynamo")
            .send({ netId, isPaidMember: true });
        }
        const entraIdToken = await getEntraIdToken({
          clients: await getAuthorizedClients(),
          clientId: fastify.environmentConfig.AadValidClientId,
          secretName: genericConfig.EntraSecretName,
          logger: request.log,
        });
        const paidMemberGroup = fastify.environmentConfig.PaidMemberGroupId;
        const isAadMember = await checkPaidMembershipFromEntra(
          netId,
          entraIdToken,
          paidMemberGroup,
        );
        if (isAadMember) {
          await setKey({
            redisClient: fastify.redisClient,
            key: cacheKey,
            data: JSON.stringify({ isMember: true }),
            expiresIn: ourCacheSeconds,
            logger: request.log,
          });
          reply
            .header("X-ACM-Data-Source", "aad")
            .send({ netId, isPaidMember: true });
          await setPaidMembershipInTable(netId, fastify.dynamoClient);
          return;
        }
        await setKey({
          redisClient: fastify.redisClient,
          key: cacheKey,
          data: JSON.stringify({ isMember: false }),
          expiresIn: ourCacheSeconds,
          logger: request.log,
        });
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
            const firstName = event.data.object.custom_fields.filter(
              (x) => x.key === "firstName",
            )[0].text?.value;
            const lastName = event.data.object.custom_fields.filter(
              (x) => x.key === "lastName",
            )[0].text?.value;
            if (!customerEmail) {
              request.log.info("No customer email found.");
              return reply
                .code(200)
                .send({ handled: false, requestId: request.id });
            }
            if (!firstName) {
              request.log.info("First name not found.");
              return reply
                .code(200)
                .send({ handled: false, requestId: request.id });
            }
            if (!lastName) {
              request.log.info("Last name not found.");
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
                  firstName,
                  lastName,
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
