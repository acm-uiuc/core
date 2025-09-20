import { FastifyPluginAsync } from "fastify";
import { AllOrganizationList } from "@acm-uiuc/js-shared";
import rateLimiter from "api/plugins/rateLimiter.js";
import { withRoles, withTags } from "api/components/index.js";
import { z } from "zod/v4";
import {
  getOrganizationInfoResponse,
  setOrganizationMetaBody,
} from "common/types/organizations.js";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import {
  BaseError,
  DatabaseFetchError,
  DatabaseInsertError,
  InternalServerError,
} from "common/errors/index.js";
import { getOrgInfo, getUserOrgRoles } from "api/functions/organizations.js";
import { AppRoles } from "common/roles.js";
import {
  PutItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { genericConfig } from "common/config.js";
import { marshall } from "@aws-sdk/util-dynamodb";
import { buildAuditLogTransactPut } from "api/functions/auditLog.js";
import { Modules } from "common/modules.js";

export const ORG_DATA_CACHED_DURATION = 300;
export const CLIENT_HTTP_CACHE_POLICY = `public, max-age=${ORG_DATA_CACHED_DURATION}, stale-while-revalidate=${Math.floor(ORG_DATA_CACHED_DURATION * 1.1)}, stale-if-error=3600`;

const organizationsPlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.register(rateLimiter, {
    limit: 60,
    duration: 60,
    rateLimitIdentifier: "organizations",
  });
  fastify.addHook("onSend", async (request, reply, payload) => {
    if (request.method === "GET") {
      reply.header("Cache-Control", CLIENT_HTTP_CACHE_POLICY);
    }
    return payload;
  });
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "",
    {
      schema: withTags(["Organizations"], {
        summary: "Get info for all of ACM @ UIUC's sub-organizations.",
        response: {
          200: {
            description: "List of ACM @ UIUC sub-organizations and info.",
            content: {
              "application/json": {
                schema: z.array(getOrganizationInfoResponse),
              },
            },
          },
        },
      }),
    },
    async (request, reply) => {
      const promises = AllOrganizationList.map((x) =>
        getOrgInfo({
          id: x,
          dynamoClient: fastify.dynamoClient,
          logger: request.log,
        }),
      );
      try {
        const data = await Promise.allSettled(promises);
        const successOnly = data
          .filter((x) => x.status === "fulfilled")
          .map((x) => x.value);
        // return just the ID for anything not in the DB.
        const successIds = successOnly.map((x) => x.id);
        const unknownIds = AllOrganizationList.filter(
          (x) => !successIds.includes(x),
        ).map((x) => ({ id: x }));
        return reply.send([...successOnly, ...unknownIds]);
      } catch (e) {
        if (e instanceof BaseError) {
          throw e;
        }
        request.log.error(e);
        throw new DatabaseFetchError({
          message: "Failed to get org information.",
        });
      }
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
      let isAuthenticated = false;
      if (request.headers.authorization) {
        try {
          await fastify.authorize(
            request,
            reply,
            [AppRoles.ALL_ORG_MANAGER],
            false,
          );
          isAuthenticated = true;
        } catch (e) {
          isAuthenticated = false;
        }
      }
      const response = await getOrgInfo({
        id: request.params.id,
        dynamoClient: fastify.dynamoClient,
        logger: request.log,
      });
      if (!isAuthenticated) {
        delete response.leadsEntraGroupId;
      }
      return reply.send(response);
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/:id/meta",
    {
      schema: withRoles(
        [AppRoles.ALL_ORG_MANAGER],
        withTags(["Organizations"], {
          summary: "Set metadata for an ACM @ UIUC sub-organization.",
          params: z.object({
            id: z
              .enum(AllOrganizationList)
              .meta({ description: "ACM @ UIUC organization to modify." }),
          }),
          body: setOrganizationMetaBody,
          response: {
            201: {
              description: "The information was saved.",
              content: {
                "application/json": {
                  schema: z.null(),
                },
              },
            },
          },
        }),
        {
          disableApiKeyAuth: false,
          notes:
            "Authenticated leads of the organization without the appropriate role may also perform this action.",
        },
      ),
      onRequest: async (request, reply) => {
        // here we check for if you lead the org right now
        let originalError = new InternalServerError({
          message: "Failed to authenticate.",
        });
        try {
          await fastify.authorizeFromSchema(request, reply);
          return;
        } catch (e) {
          if (e instanceof BaseError) {
            originalError = e;
          } else {
            throw e;
          }
        }
        if (!request.username) {
          throw originalError;
        }
        const userRoles = await getUserOrgRoles({
          username: request.username,
          dynamoClient: fastify.dynamoClient,
          logger: request.log,
        });
        for (const role of userRoles) {
          if (role.org === request.params.id && role.role === "LEAD") {
            return;
          }
        }
        throw originalError;
      },
    },
    async (request, reply) => {
      try {
        const logStatement = buildAuditLogTransactPut({
          entry: {
            module: Modules.ORG_INFO,
            message: "Updated organization metadata.",
            actor: request.username!,
            target: request.params.id,
          },
        });
        const commandTransaction = new TransactWriteItemsCommand({
          TransactItems: [
            ...(logStatement ? [logStatement] : []),
            {
              Put: {
                TableName: genericConfig.SigInfoTableName,
                Item: marshall(
                  {
                    ...request.body,
                    primaryKey: `DEFINE#${request.params.id}`,
                    entryId: "0",
                  },
                  { removeUndefinedValues: true },
                ),
              },
            },
          ],
        });
        await fastify.dynamoClient.send(commandTransaction);
      } catch (e) {
        if (e instanceof BaseError) {
          throw e;
        }
        request.log.error(e);
        throw new DatabaseInsertError({
          message: "Failed to set org information.",
        });
      }
      return reply.status(201).send();
    },
  );
};

export default organizationsPlugin;
