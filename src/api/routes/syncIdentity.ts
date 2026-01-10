import {
  checkPaidMembershipFromTable,
  checkPaidMembershipFromRedis,
} from "api/functions/membership.js";
import { FastifyPluginAsync } from "fastify";
import rateLimiter from "api/plugins/rateLimiter.js";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import * as z from "zod/v4";
import { notAuthenticatedError, withTags } from "api/components/index.js";
import {
  getUserUin,
  saveUserUin,
  verifyUiucAccessToken,
} from "api/functions/uin.js";
import { getRoleCredentials } from "api/functions/sts.js";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { genericConfig, roleArns } from "common/config.js";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  getEntraIdToken,
  patchUserProfile,
  resolveEmailToOid,
} from "api/functions/entraId.js";
import { syncFullProfile } from "api/functions/sync.js";
import { getUserIdentity, UserIdentity } from "api/functions/identity.js";
import { SSMClient } from "@aws-sdk/client-ssm";

const syncIdentityPlugin: FastifyPluginAsync = async (fastify, _options) => {
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
        ssmClient: new SSMClient({
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
      ssmClient: new SSMClient({ region: genericConfig.AwsRegion }),
      dynamoClient: fastify.dynamoClient,
      redisClient: fastify.redisClient,
    };
  };
  const limitedRoutes: FastifyPluginAsync = async (fastify) => {
    await fastify.register(rateLimiter, {
      limit: 5,
      duration: 30,
      rateLimitIdentifier: "syncIdentityPlugin",
    });
    fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
      "/",
      {
        schema: withTags(["Generic"], {
          headers: z.object({
            "x-uiuc-token": z.jwt().min(1).meta({
              description:
                "An access token for the user in the UIUC Entra ID tenant.",
            }),
          }),
          summary:
            "Sync the Illinois NetID account with the ACM @ UIUC account.",
          response: {
            201: {
              description: "The user has been synced.",
              content: {
                "application/json": {
                  schema: z.null(),
                },
              },
            },
            403: notAuthenticatedError,
          },
        }),
      },
      async (request, reply) => {
        const accessToken = request.headers["x-uiuc-token"];
        const { givenName, surname, netId } = await verifyUiucAccessToken({
          accessToken,
          logger: request.log,
        });
        await syncFullProfile({
          firstName: givenName,
          lastName: surname,
          netId,
          dynamoClient: fastify.dynamoClient,
          redisClient: fastify.redisClient,
          stripeApiKey: fastify.secretConfig.stripe_secret_key,
          logger: request.log,
        });

        await saveUserUin({
          uiucAccessToken: accessToken,
          dynamoClient: fastify.dynamoClient,
          netId,
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
        if (isPaidMember) {
          const username = `${netId}@illinois.edu`;
          request.log.info("User is paid member, syncing Entra user!");
          const entraIdToken = await getEntraIdToken({
            clients: await getAuthorizedClients(),
            clientId: fastify.environmentConfig.AadValidClientId,
            logger: request.log,
          });
          const oid = await resolveEmailToOid(entraIdToken, username);
          await patchUserProfile(entraIdToken, username, oid, {
            displayName: `${givenName} ${surname}`,
            givenName,
            surname,
            mail: username,
          });
        }
        return reply.status(201).send();
      },
    );
    fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
      "/isRequired",
      {
        schema: withTags(["Generic"], {
          headers: z.object({
            "x-uiuc-token": z.jwt().min(1).meta({
              description:
                "An access token for the user in the UIUC Entra ID tenant.",
            }),
          }),
          summary: "Check if a user needs a full user identity sync.",
          response: {
            200: {
              description: "The status was retrieved.",
              content: {
                "application/json": {
                  schema: z.object({
                    syncRequired: z.boolean().default(false),
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
        const { netId } = await verifyUiucAccessToken({
          accessToken,
          logger: request.log,
        });
        const userIdentity = await getUserIdentity({
          netId,
          dynamoClient: fastify.dynamoClient,
          logger: request.log,
        });

        const requiredFields: (keyof UserIdentity)[] = [
          "uin",
          "firstName",
          "lastName",
          "stripeCustomerId",
        ];

        const syncRequired =
          !userIdentity || requiredFields.some((field) => !userIdentity[field]);
        return reply.send({ syncRequired });
      },
    );
  };
  fastify.register(limitedRoutes);
};

export default syncIdentityPlugin;
