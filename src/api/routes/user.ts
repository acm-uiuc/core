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
  batchResolveUserInfoRequest,
  batchResolveUserInfoResponse,
  searchUserByUinRequest,
  searchUserByUinResponse,
} from "common/types/user.js";
import {
  batchGetUserInfo,
  getUinHash,
  getUserIdByUin,
} from "api/functions/uin.js";
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
        [AppRoles.VIEW_USER_INFO],
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
      return reply.send(
        await getUserIdByUin({
          dynamoClient: fastify.dynamoClient,
          uin: request.body.uin,
          pepper: fastify.secretConfig.UIN_HASHING_SECRET_PEPPER,
        }),
      );
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/batchResolveInfo",
    {
      schema: withRoles(
        [],
        withTags(["Generic"], {
          summary: "Resolve user emails to user info.",
          body: batchResolveUserInfoRequest,
          response: {
            200: {
              description: "The search was performed.",
              content: {
                "application/json": {
                  schema: batchResolveUserInfoResponse,
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      return reply.send(
        await batchGetUserInfo({
          dynamoClient: fastify.dynamoClient,
          emails: request.body.emails,
          logger: request.log,
        }),
      );
    },
  );
};

export default userRoute;
