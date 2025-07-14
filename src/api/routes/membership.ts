import {
  checkExternalMembership,
  checkPaidMembershipFromEntra,
  checkPaidMembershipFromTable,
  setPaidMembershipInTable,
  MEMBER_CACHE_SECONDS,
  getExternalMemberList,
  patchExternalMemberList,
} from "api/functions/membership.js";
import { FastifyPluginAsync } from "fastify";
import {
  BaseError,
  DatabaseFetchError,
  InternalServerError,
  ValidationError,
} from "common/errors/index.js";
import { getEntraIdToken } from "api/functions/entraId.js";
import { genericConfig, roleArns } from "common/config.js";
import { getRoleCredentials } from "api/functions/sts.js";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import {
  BatchWriteItemCommand,
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import rateLimiter from "api/plugins/rateLimiter.js";
import { createCheckoutSession } from "api/functions/stripe.js";
import { getSecretValue } from "api/plugins/auth.js";
import stripe, { Stripe } from "stripe";
import { AvailableSQSFunctions, SQSPayload } from "common/types/sqsMessage.js";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import rawbody from "fastify-raw-body";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import * as z from "zod/v4";
import { illinoisNetId, withRoles, withTags } from "api/components/index.js";
import { getKey, setKey } from "api/functions/redisCache.js";
import { AppRoles } from "common/roles.js";
import { unmarshall } from "@aws-sdk/util-dynamodb";

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
          response: {
            200: {
              description: "List membership status.",
              content: {
                "application/json": {
                  schema: z
                    .object({
                      netId: illinoisNetId,
                      list: z.optional(z.string().min(1)),
                      isPaidMember: z.boolean(),
                    })
                    .meta({
                      example: {
                        netId: "rjjones",
                        isPaidMember: false,
                      },
                    }),
                },
              },
            },
          },
        }),
      },
      async (request, reply) => {
        const netId = request.params.netId.toLowerCase();
        const list = request.query.list || "acmpaid";
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
            expiresIn: MEMBER_CACHE_SECONDS,
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
            expiresIn: MEMBER_CACHE_SECONDS,
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
            expiresIn: MEMBER_CACHE_SECONDS,
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
          expiresIn: MEMBER_CACHE_SECONDS,
          logger: request.log,
        });
        return reply
          .header("X-ACM-Data-Source", "aad")
          .send({ netId, isPaidMember: false });
      },
    );
    fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
      "/externalList",
      {
        schema: withRoles(
          [
            AppRoles.VIEW_EXTERNAL_MEMBERSHIP_LIST,
            AppRoles.MANAGE_EXTERNAL_MEMBERSHIP_LIST,
          ],
          withTags(["Membership"], {
            summary: "Get all member list IDs",
            response: {
              200: {
                description: "The list of member list was retrieved.",
                content: {
                  "application/json": {
                    schema: z.array(z.string().min(1)).meta({
                      example: ["built", "chancellors"],
                      description: "List IDs for the member lists.",
                    }),
                  },
                },
              },
            },
          }),
        ),
        onRequest: fastify.authorizeFromSchema,
      },
      async (_request, reply) => {
        const command = new ScanCommand({
          TableName: genericConfig.ExternalMembershipTableName,
          IndexName: "keysOnlyIndex",
        });
        const response = await fastify.dynamoClient.send(command);
        if (!response || !response.Items) {
          throw new DatabaseFetchError({
            message: "Failed to get all member lists.",
          });
        }
        const deduped = [
          ...new Set(
            response.Items.map((x) => unmarshall(x))
              .filter((x) => !!x)
              .map((x) => x.memberList),
          ),
        ];
        return reply.send(deduped);
      },
    );
    // I would have liked to do an overwrite here, but delete all in PK isn't atomic in Dynamo.
    // So, it makes more sense for the user to confirm on their end that the list has in fact all been deleted.
    fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().patch(
      "/externalList/:listId",
      {
        schema: withRoles(
          [AppRoles.MANAGE_EXTERNAL_MEMBERSHIP_LIST],
          withTags(["Membership"], {
            params: z.object({
              listId: z
                .string()
                .min(1)
                .refine((val) => val !== "acmpaid", {
                  message: `List ID cannot be "acmpaid"`,
                })
                .meta({
                  description: `External membership list ID (cannot be "acmpaid").`,
                  example: "chancellor",
                }),
            }),
            summary: "Modify members of an external organization",
            body: z.object({
              remove: z.array(illinoisNetId),
              add: z.array(
                illinoisNetId.meta({
                  example: "isbell",
                }),
              ),
            }),
            response: {
              201: {
                description: "The member list was modified.",
                content: {
                  "application/json": {
                    schema: z.null(),
                  },
                },
              },
            },
          }),
        ),
        onRequest: fastify.authorizeFromSchema,
      },
      async (request, reply) => {
        const { listId } = request.params;
        const { add = [], remove = [] } = request.body;
        const { dynamoClient, redisClient } = fastify;
        await patchExternalMemberList({
          add,
          remove,
          listId,
          clients: { dynamoClient, redisClient },
          logger: request.log,
        });
        return reply.status(201).send();
      },
    );
    fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
      "/externalList/:listId",
      {
        schema: withRoles(
          [
            AppRoles.VIEW_EXTERNAL_MEMBERSHIP_LIST,
            AppRoles.MANAGE_EXTERNAL_MEMBERSHIP_LIST,
          ],
          withTags(["Membership"], {
            params: z.object({
              listId: z
                .string()
                .min(1)
                .refine((val) => val !== "acmpaid", {
                  message: `List ID cannot be "acmpaid"`,
                })
                .meta({
                  description: `External membership list ID (cannot be "acmpaid")`,
                  example: "built",
                }),
            }),
            summary: "Get all members of an external organization",
            response: {
              200: {
                description: "The member list was retrieved.",
                content: {
                  "application/json": {
                    schema: z.array(illinoisNetId).meta({
                      example: ["rjjones", "tkilleen"],
                      description:
                        "Illinois NetIDs for the members of the external organization.",
                    }),
                  },
                },
              },
            },
          }),
        ),
        onRequest: fastify.authorizeFromSchema,
      },
      async (request, reply) => {
        const listId = request.params.listId.toLowerCase();
        const list = await getExternalMemberList(listId, fastify.dynamoClient);
        return reply.send(list);
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
