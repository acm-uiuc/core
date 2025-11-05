import { FastifyPluginAsync } from "fastify";
import rateLimiter from "api/plugins/rateLimiter.js";
import { withRoles, withTags } from "api/components/index.js";
import { getUserOrgRoles } from "api/functions/organizations.js";
import {
  DatabaseFetchError,
  UnauthenticatedError,
  ValidationError,
} from "common/errors/index.js";
import * as z from "zod/v4";
import {
  searchUserByUinRequest,
  searchUserByUinResponse,
} from "common/types/user.js";
import { getUinHash } from "api/functions/uin.js";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { genericConfig } from "common/config.js";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { AppRoles } from "common/roles.js";

const userRoute: FastifyPluginAsync = async (fastify, _options) => {
  await fastify.register(rateLimiter, {
    limit: 45,
    duration: 30,
    rateLimitIdentifier: "user",
  });
  // This route is a POST to avoid leaking/storing UINs in logs everywhere
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/findUserByUin",
    {
      schema: withRoles(
        [
          AppRoles.VIEW_USER_INFO,
          AppRoles.TICKETS_MANAGER,
          AppRoles.TICKETS_SCANNER,
        ],
        withTags(["Generic"], {
          summary: "Find a user by UIN.",
          body: searchUserByUinRequest,
          response: {
            200: {
              description: "User located.",
              content: {
                "application/json": {
                  schema: searchUserByUinResponse,
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      const uinHash = await getUinHash({
        pepper: fastify.secretConfig.UIN_HASHING_SECRET_PEPPER,
        uin: request.body.uin,
      });
      const queryCommand = new QueryCommand({
        TableName: genericConfig.UserInfoTable,
        IndexName: "UinHashIndex",
        KeyConditionExpression: "uinHash = :hash",
        ExpressionAttributeValues: {
          ":hash": { S: uinHash },
        },
      });
      const response = await fastify.dynamoClient.send(queryCommand);
      if (!response || !response.Items) {
        throw new DatabaseFetchError({
          message: "Failed to retrieve user from database.",
        });
      }
      if (response.Items.length === 0) {
        throw new ValidationError({
          message:
            "Failed to find user in database. Please have the user run sync and try again.",
        });
      }
      if (response.Items.length > 1) {
        throw new ValidationError({
          message:
            "Multiple users tied to this UIN. This user probably had a NetID change. Please contact support.",
        });
      }
      const data = unmarshall(response.Items[0]) as { id: string };
      return reply.send({
        email: data.id,
      });
    },
  );
};

export default userRoute;
