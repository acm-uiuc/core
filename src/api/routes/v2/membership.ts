import {
  checkPaidMembershipFromTable,
  checkPaidMembershipFromRedis,
  checkExternalMembership,
  MEMBER_CACHE_SECONDS,
  checkPaidMembershipFromEntra,
  setPaidMembershipInTable,
} from "api/functions/membership.js";
import { FastifyPluginAsync } from "fastify";
import {
  InternalServerError,
  UnauthorizedError,
  ValidationError,
} from "common/errors/index.js";
import rateLimiter from "api/plugins/rateLimiter.js";
import { createCheckoutSession } from "api/functions/stripe.js";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import * as z from "zod/v4";
import {
  illinoisNetId,
  notAuthenticatedError,
  withRoles,
  withTags,
} from "api/components/index.js";
import { verifyUiucAccessToken, getHashedUserUin } from "api/functions/uin.js";
import { getKey, setKey } from "api/functions/redisCache.js";
import { getEntraIdToken } from "api/functions/entraId.js";
import { genericConfig, roleArns } from "common/config.js";
import { getRoleCredentials } from "api/functions/sts.js";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { BatchGetItemCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { AppRoles } from "common/roles.js";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { syncFullProfile } from "api/functions/sync.js";

const membershipV2Plugin: FastifyPluginAsync = async (fastify, _options) => {
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
        const { userPrincipalName: upn, givenName, surname } = verifiedData;
        const netId = upn.replace("@illinois.edu", "");
        if (netId.includes("@")) {
          request.log.error(
            `Found UPN ${upn} which cannot be turned into NetID via simple replacement.`,
          );
          throw new ValidationError({
            message: "ID token could not be parsed.",
          });
        }
        request.log.debug("Saving user hashed UIN!");
        const uinHash = await getHashedUserUin({
          uiucAccessToken: accessToken,
          pepper: fastify.secretConfig.UIN_HASHING_SECRET_PEPPER,
        });
        const savePromise = syncFullProfile({
          uinHash,
          firstName: givenName,
          lastName: surname,
          netId,
          dynamoClient: fastify.dynamoClient,
        });
        let isPaidMember = await checkPaidMembershipFromRedis(
          netId,
          fastify.redisClient,
          request.log,
        );
        if (isPaidMember === null) {
          isPaidMember = await checkPaidMembershipFromTable(
            netId,
            fastify.dynamoClient,
          );
        }
        await savePromise;
        request.log.debug("Saved user hashed UIN!");
        if (isPaidMember) {
          throw new ValidationError({
            message: `${upn} is already a paid member.`,
          });
        }
        return reply.status(200).send(
          await createCheckoutSession({
            successUrl: "https://acm.illinois.edu/paid",
            returnUrl: "https://acm.illinois.edu/membership",
            customerEmail: upn,
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

        const cacheKeys = netIdsToCheck.map((id) => `membership:${id}:${list}`);
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
            const isMember = await checkExternalMembership(
              netId,
              list,
              fastify.dynamoClient,
            );
            if (isMember) {
              members.add(netId);
            } else {
              notMembers.add(netId);
            }
            cachePipeline.set(
              `membership:${netId}:${list}`,
              JSON.stringify({ isMember }),
              "EX",
              MEMBER_CACHE_SECONDS,
            );
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
              console.log(id, isPaidMember);
              const netId = id.split("@")[0];
              foundInDynamo.add(netId);
              if (isPaidMember === true) {
                members.add(netId);
                cachePipeline.set(
                  `membership:${netId}:${list}`,
                  JSON.stringify({ isMember: true }),
                  "EX",
                  MEMBER_CACHE_SECONDS,
                );
              }
            }
          }

          const netIdsForEntra = netIdsToCheck.filter(
            (id) => !foundInDynamo.has(id),
          );
          if (netIdsForEntra.length > 0) {
            const entraIdToken = await getEntraIdToken({
              clients: await getAuthorizedClients(),
              clientId: fastify.environmentConfig.AadValidClientId,
              secretName: genericConfig.EntraSecretName,
              logger: request.log,
            });
            const paidMemberGroup = fastify.environmentConfig.PaidMemberGroupId;
            const entraCheckPromises = netIdsForEntra.map(async (netId) => {
              const isMember = await checkPaidMembershipFromEntra(
                netId,
                entraIdToken,
                paidMemberGroup,
              );
              if (isMember) {
                members.add(netId);
                setPaidMembershipInTable(netId, fastify.dynamoClient).catch(
                  (err) =>
                    request.log.error(
                      err,
                      `Failed to write back Entra membership for ${netId}`,
                    ),
                );
              } else {
                notMembers.add(netId);
              }
              cachePipeline.set(
                `membership:${netId}:${list}`,
                JSON.stringify({ isMember }),
                "EX",
                MEMBER_CACHE_SECONDS,
              );
            });
            await Promise.all(entraCheckPromises);
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
  };
  fastify.register(limitedRoutes);
};

export default membershipV2Plugin;
