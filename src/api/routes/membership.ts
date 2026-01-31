import {
  checkExternalMembership,
  checkPaidMembershipFromTable,
  MEMBER_CACHE_SECONDS,
  getExternalMemberList,
  patchExternalMemberList,
  checkPaidMembership,
  checkMemberOfAnyList,
} from "api/functions/membership.js";
import { FastifyPluginAsync } from "fastify";
import {
  BaseError,
  DatabaseFetchError,
  InternalServerError,
  ValidationError,
} from "common/errors/index.js";
import { genericConfig } from "common/config.js";
import { ScanCommand } from "@aws-sdk/client-dynamodb";
import rateLimiter from "api/plugins/rateLimiter.js";
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
import { verifyUiucAccessToken } from "api/functions/uin.js";
import { assertAuthenticated } from "api/authenticated.js";
import { ArrayFromString } from "common/types/generic.js";

const membershipPlugin: FastifyPluginAsync = async (fastify, _options) => {
  await fastify.register(rawbody, {
    field: "rawBody",
    global: false,
    runFirst: true,
  });
  const limitedRoutes: FastifyPluginAsync = async (fastify) => {
    await fastify.register(rateLimiter, {
      limit: 20,
      duration: 30,
      rateLimitIdentifier: "membership",
    });
    fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
      "/",
      {
        schema: withTags(["Membership"], {
          headers: z.object({
            "x-uiuc-token": z.jwt().min(1).meta({
              description:
                "An access token for the user in the UIUC Entra ID tenant.",
            }),
          }),
          querystring: z.object({
            lists: ArrayFromString.default(["acmpaid"]).meta({
              description:
                "The lists to check membership in (internal or external).",
              examples: [["acmpaid"], ["acmpaid", "built"]],
            }),
          }),
          summary: "Check self membership in any of specified lists.",
          response: {
            200: {
              description: "List membership status.",
              content: {
                "application/json": {
                  schema: z
                    .object({
                      givenName: z.string().min(1),
                      surname: z.string().min(1),
                      netId: illinoisNetId,
                      isPaidMember: z.boolean(),
                    })
                    .meta({
                      example: {
                        givenName: "Robert",
                        surname: "Jones",
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
        const accessToken = request.headers["x-uiuc-token"];
        const { netId, givenName, surname } = await verifyUiucAccessToken({
          accessToken,
          logger: request.log,
        });
        const { dynamoClient, redisClient } = fastify;
        const isPaidMember = await checkMemberOfAnyList({
          netId,
          lists: request.query.lists,
          dynamoClient,
          redisClient,
          logger: request.log,
        });
        return reply.send({
          givenName,
          surname,
          netId,
          isPaidMember,
        });
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
        ].sort();
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
      assertAuthenticated(async (request, reply) => {
        const { listId } = request.params;
        const { add = [], remove = [] } = request.body;
        const { dynamoClient, redisClient } = fastify;
        await patchExternalMemberList({
          add,
          remove,
          listId,
          clients: { dynamoClient, redisClient },
          logger: request.log,
          auditLogData: {
            actor: request.username,
            requestId: request.id,
          },
        });
        return reply.status(201).send();
      }),
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
            const customerEmail =
              event.data.object.customer_email ||
              event.data.object.customer_details?.email;
            const firstName = event.data.object.metadata.givenName;
            const lastName = event.data.object.metadata.surname;
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
                MessageGroupId: "membershipProvisioning",
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
