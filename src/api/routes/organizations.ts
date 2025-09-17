import { FastifyPluginAsync } from "fastify";
import { AllOrganizationList } from "@acm-uiuc/js-shared";
import fastifyCaching from "@fastify/caching";
import rateLimiter from "api/plugins/rateLimiter.js";
import { withTags } from "api/components/index.js";
import { z } from "zod/v4";
import { getOrganizationInfoResponse } from "common/types/organizations.js";
import {
  GetItemCommand,
  QueryCommand,
  ReplicaAlreadyExistsException,
} from "@aws-sdk/client-dynamodb";
import { genericConfig } from "common/config.js";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import {
  BaseError,
  DatabaseFetchError,
  NotFoundError,
} from "common/errors/index.js";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { getOrgInfo } from "api/functions/organizations.js";

const organizationsPlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.register(fastifyCaching, {
    privacy: fastifyCaching.privacy.PUBLIC,
    serverExpiresIn: 60 * 60 * 4,
    expiresIn: 60 * 60 * 4,
  });
  fastify.register(rateLimiter, {
    limit: 60,
    duration: 60,
    rateLimitIdentifier: "organizations",
  });
  fastify.get(
    "",
    {
      schema: withTags(["Organizations"], {
        summary: "Get a list of ACM @ UIUC sub-organizations.",
        response: {
          200: {
            description: "List of ACM @ UIUC sub-organizations.",
            content: {
              "application/json": {
                schema: z
                  .array(z.enum(AllOrganizationList))
                  .default(AllOrganizationList),
              },
            },
          },
        },
      }),
    },
    async (_request, reply) => {
      reply.send(AllOrganizationList);
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/:id",
    {
      schema: withTags(["Organizations"], {
        summary:
          "Get information about a specific ACM @ UIUC sub-organization.",
        params: z.object({
          id: z
            .enum(AllOrganizationList)
            .meta({ description: "ACM @ UIUC organization to query." }),
        }),
        response: {
          200: {
            description: "ACM @ UIUC sub-organization info.",
            content: {
              "application/json": {
                schema: getOrganizationInfoResponse,
              },
            },
          },
        },
      }),
    },
    async (request, reply) => {
      const response = await getOrgInfo({
        id: request.params.id,
        dynamoClient: fastify.dynamoClient,
        logger: request.log,
      });
      return reply.send(response);
    },
  );
};

export default organizationsPlugin;
