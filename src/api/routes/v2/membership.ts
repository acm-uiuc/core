import {
  checkPaidMembershipFromTable,
  checkExternalMembership,
  MEMBER_CACHE_SECONDS,
  checkPaidMembership,
  getMembershipCacheKey,
} from "api/functions/membership.js";
import { FastifyPluginAsync } from "fastify";
import {
  InternalServerError,
  UnauthorizedError,
  ValidationError,
} from "common/errors/index.js";
import rateLimiter from "api/plugins/rateLimiter.js";
import { createCheckoutSessionWithCustomer } from "api/functions/stripe.js";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import * as z from "zod/v4";
import {
  illinoisNetId,
  notAuthenticatedError,
  withRoles,
  withTags,
} from "api/components/index.js";
import { verifyUiucAccessToken, saveUserUin } from "api/functions/uin.js";
import { getKey, setKey } from "api/functions/redisCache.js";
import { genericConfig } from "common/config.js";
import { BatchGetItemCommand } from "@aws-sdk/client-dynamodb";
import { AppRoles } from "common/roles.js";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { syncFullProfile } from "api/functions/sync.js";
import { BooleanFromString, maxLength } from "common/types/generic.js";
import { getNetIdFromEmail } from "common/utils.js";

const membershipV2Plugin: FastifyPluginAsync = async (fastify, _options) => {
  const limitedRoutes: FastifyPluginAsync = async (fastify) => {
    await fastify.register(rateLimiter, {
      limit: 15,
      duration: 30,
      rateLimitIdentifier: "membershipV2",
    });
    fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
      "/checkout",
      {
        schema: withTags(["Membership"], {
          headers: z.object({
            "x-uiuc-token": z.jwt().min(1).meta({
              description:
                "An access token for the user in the UIUC Entra ID tenant.",
            }),
          }),
          querystring: z.object({
            force: BooleanFromString.optional().default(false).meta({
              description:
                "If true, the user will be allowed to checkout even if they are already a paid member.",
            }),
          }),
          summary:
            "Create a checkout session to purchase an ACM @ UIUC membership.",
          response: {
            200: {
              description: "Stripe checkout link.",
              content: {
                "text/plain": {
                  schema: z.url().meta({
                    example:
                      "https://buy.stripe.com/test_14A00j9Hq9tj9ZfchM3AY0s",
                  }),
                },
              },
            },
            403: notAuthenticatedError,
          },
        }),
      },
      async (request, reply) => {
        const accessToken = request.headers["x-uiuc-token"];
        const verifiedData = await verifyUiucAccessToken({
          accessToken,
          logger: request.log,
        });
        const {
          netId,
          userPrincipalName: upn,
          givenName,
          surname,
        } = verifiedData;
        if (request.query.force) {
          request.log.warn(
            `User ${upn} has forcefully bypassed the existing paid member check for purchasing a new membership!`,
          );
        }
        const { redisClient, dynamoClient } = fastify;
        request.log.debug("Saving user UIN!");
        const saveProfilePromise = syncFullProfile({
          firstName: givenName,
          lastName: surname,
          netId,
          dynamoClient,
          redisClient,
          stripeApiKey: fastify.secretConfig.stripe_secret_key,
          logger: request.log,
        });
        const saveUinPromise = saveUserUin({
          uiucAccessToken: accessToken,
          dynamoClient: fastify.dynamoClient,
          netId,
        });
        const isPaidMember = await checkPaidMembership({
          netId,
          redisClient,
          dynamoClient,
          logger: request.log,
        });
        const data = await Promise.allSettled([
          saveProfilePromise,
          saveUinPromise,
        ]);
        const userData =
          data[0].status === "rejected" ? undefined : data[0].value;
        if (!userData) {
          request.log.error("Tried to save profile but got nothing back!");
          throw new InternalServerError({});
        }
        if (isPaidMember && !request.query.force) {
          throw new ValidationError({
            message: `${upn} is already a paid member.`,
          });
        }
        return reply.status(200).send(
          await createCheckoutSessionWithCustomer({
            successUrl: "https://acm.illinois.edu/membership/paid",
            returnUrl: "https://acm.illinois.edu/membership",
            customerId: userData.stripeCustomerId,
            stripeApiKey: fastify.secretConfig.stripe_secret_key as string,
            items: [
              {
                price: fastify.environmentConfig.PaidMemberPriceId,
                quantity: 1,
              },
            ],
            metadata: {
              givenName,
              surname,
            },
            initiator: "purchase-membership",
            allowPromotionCodes: true,
            statementDescriptorSuffix: maxLength("MBRSHIP", 7),
            delayedSettlementAllowed: false,
          }),
        );
      },
    );
    fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
      "/verifyBatchOfMembers",
      {
        schema: withRoles(
          [
            AppRoles.VIEW_INTERNAL_MEMBERSHIP_LIST,
            AppRoles.VIEW_EXTERNAL_MEMBERSHIP_LIST,
          ],
          withTags(["Membership"], {
            body: z.array(illinoisNetId).nonempty().max(500),
            querystring: z.object({
              list: z.string().min(1).optional().meta({
                example: "built",
                description:
                  "Membership list to check from (defaults to ACM Paid Member list).",
              }),
            }),
            summary:
              "Check a batch of NetIDs for ACM @ UIUC paid membership (or partner organization membership) status.",
            response: {
              200: {
                description: "List membership status.",
                content: {
                  "application/json": {
                    schema: z
                      .object({
                        members: z.array(illinoisNetId),
                        notMembers: z.array(illinoisNetId),
                        list: z.optional(z.string().min(1)),
                      })
                      .meta({
                        example: {
                          members: ["rjjones"],
                          notMembers: ["isbell"],
                          list: "built",
                        },
                      }),
                  },
                },
              },
            },
          }),
        ),
        onRequest: async (request, reply) => {
          await fastify.authorizeFromSchema(request, reply);
          if (!request.userRoles) {
            throw new InternalServerError({});
          }
          const list = request.query.list || "acmpaid";
          if (
            list === "acmpaid" &&
            !request.userRoles.has(AppRoles.VIEW_INTERNAL_MEMBERSHIP_LIST)
          ) {
            throw new UnauthorizedError({});
          }
          if (
            list !== "acmpaid" &&
            !request.userRoles.has(AppRoles.VIEW_EXTERNAL_MEMBERSHIP_LIST)
          ) {
            throw new UnauthorizedError({});
          }
        },
      },
      async (request, reply) => {
        const list = request.query.list || "acmpaid";
        let netIdsToCheck = [
          ...new Set(request.body.map((id) => id.toLowerCase())),
        ];

        const members = new Set<string>();
        const notMembers = new Set<string>();

        const cacheKeys = netIdsToCheck.map((id) =>
          getMembershipCacheKey(id, list),
        );
        if (cacheKeys.length > 0) {
          const cachedResults = await fastify.redisClient.mget(cacheKeys);
          const remainingNetIds: string[] = [];
          cachedResults.forEach((result, index) => {
            const netId = netIdsToCheck[index];
            if (result) {
              const { isMember } = JSON.parse(result) as { isMember: boolean };
              if (isMember) {
                members.add(netId);
              } else {
                notMembers.add(netId);
              }
            } else {
              remainingNetIds.push(netId);
            }
          });
          netIdsToCheck = remainingNetIds;
        }

        if (netIdsToCheck.length === 0) {
          return reply.send({
            members: [...members].sort(),
            notMembers: [...notMembers].sort(),
            list: list === "acmpaid" ? undefined : list,
          });
        }

        const cachePipeline = fastify.redisClient.pipeline();

        if (list !== "acmpaid") {
          // can't do batch get on an index.
          const checkPromises = netIdsToCheck.map(async (netId) => {
            const isMember = await checkExternalMembership({
              netId,
              list,
              dynamoClient: fastify.dynamoClient,
              redisClient: fastify.redisClient,
              logger: request.log,
            });
            if (isMember) {
              members.add(netId);
            } else {
              notMembers.add(netId);
            }
          });
          await Promise.all(checkPromises);
        } else {
          const BATCH_SIZE = 100;
          const foundInDynamo = new Set<string>();
          for (let i = 0; i < netIdsToCheck.length; i += BATCH_SIZE) {
            const batch = netIdsToCheck.slice(i, i + BATCH_SIZE);
            const command = new BatchGetItemCommand({
              RequestItems: {
                [genericConfig.UserInfoTable]: {
                  Keys: batch.map((netId) =>
                    marshall({ id: `${netId}@illinois.edu` }),
                  ),
                  AttributesToGet: ["id", "isPaidMember"],
                },
              },
            });

            const { Responses } = await fastify.dynamoClient.send(command);
            const items = Responses?.[genericConfig.UserInfoTable] ?? [];
            for (const item of items) {
              const { id, isPaidMember } = unmarshall(item);
              const netId = getNetIdFromEmail(id);
              foundInDynamo.add(netId);
              if (isPaidMember === true) {
                members.add(netId);
                cachePipeline.set(
                  `membership:${netId}:${list}`,
                  JSON.stringify({ isMember: true }),
                  "EX",
                  MEMBER_CACHE_SECONDS,
                );
              } else {
                notMembers.add(netId);
              }
            }
          }
        }

        if (cachePipeline.length > 0) {
          await cachePipeline.exec();
        }

        return reply.send({
          members: [...members].sort(),
          notMembers: [...notMembers].sort(),
          list: list === "acmpaid" ? undefined : list,
        });
      },
    );

    fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
      "/:netId",
      {
        schema: withRoles(
          [
            AppRoles.VIEW_INTERNAL_MEMBERSHIP_LIST,
            AppRoles.VIEW_EXTERNAL_MEMBERSHIP_LIST,
          ],
          withTags(["Membership"], {
            params: z.object({ netId: illinoisNetId }),
            querystring: z.object({
              list: z.string().min(1).optional().meta({
                example: "built",
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
                          list: "built",
                          isPaidMember: false,
                        },
                      }),
                  },
                },
              },
            },
          }),
        ),
        onRequest: async (request, reply) => {
          await fastify.authorizeFromSchema(request, reply);
          if (!request.userRoles) {
            throw new InternalServerError({});
          }
          const list = request.query.list || "acmpaid";
          if (
            list === "acmpaid" &&
            !request.userRoles.has(AppRoles.VIEW_INTERNAL_MEMBERSHIP_LIST)
          ) {
            throw new UnauthorizedError({});
          }
          if (
            list !== "acmpaid" &&
            !request.userRoles.has(AppRoles.VIEW_EXTERNAL_MEMBERSHIP_LIST)
          ) {
            throw new UnauthorizedError({});
          }
        },
      },
      async (request, reply) => {
        const netId = request.params.netId.toLowerCase();
        const list = request.query.list || "acmpaid";
        const cacheKey = getMembershipCacheKey(netId, list);
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
          const isMember = await checkExternalMembership({
            netId,
            list,
            dynamoClient: fastify.dynamoClient,
            redisClient: fastify.redisClient,
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
        await setKey({
          redisClient: fastify.redisClient,
          key: cacheKey,
          data: JSON.stringify({ isMember: false }),
          expiresIn: MEMBER_CACHE_SECONDS,
          logger: request.log,
        });
        return reply
          .header("X-ACM-Data-Source", "dynamo")
          .send({ netId, isPaidMember: false });
      },
    );
  };
  fastify.register(limitedRoutes);
};

export default membershipV2Plugin;
