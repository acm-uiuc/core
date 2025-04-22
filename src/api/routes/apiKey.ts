import { FastifyPluginAsync } from "fastify";
import rateLimiter from "api/plugins/rateLimiter.js";
import { withRoles, withTags } from "api/components/index.js";
import { AppRoles } from "common/roles.js";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import { ApiKeyDynamoEntry, apiKeyPostBody } from "common/types/apiKey.js";
import { createApiKey } from "api/functions/apiKey.js";
import { buildAuditLogTransactPut } from "api/functions/auditLog.js";
import { Modules } from "common/modules.js";
import { genericConfig } from "common/config.js";
import { marshall } from "@aws-sdk/util-dynamodb";
import {
  ConditionalCheckFailedException,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import {
  BaseError,
  DatabaseDeleteError,
  DatabaseInsertError,
  ValidationError,
} from "common/errors/index.js";
import { z } from "zod";

const apiKeyRoute: FastifyPluginAsync = async (fastify, _options) => {
  await fastify.register(rateLimiter, {
    limit: 5,
    duration: 30,
    rateLimitIdentifier: "apiKey",
  });
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/org",
    {
      schema: withRoles(
        [AppRoles.MANAGE_ORG_API_KEYS],
        withTags(["API Keys"], {
          summary: "Create an API key not tied to a specific user.",
          body: apiKeyPostBody,
        }),
        { disableApiKeyAuth: true },
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      const { roles, description, expiresAt } = request.body;
      const { apiKey, hashedKey, keyId } = await createApiKey();
      const logStatement = buildAuditLogTransactPut({
        entry: {
          module: Modules.API_KEY,
          message: `Created API key.`,
          actor: request.username!,
          target: `acmuiuc_${keyId}`,
          requestId: request.id,
        },
      });
      const apiKeyPayload: ApiKeyDynamoEntry = {
        keyId,
        keyHash: hashedKey,
        roles,
        description,
        owner: request.username!,
        createdAt: Math.floor(Date.now() / 1000),
        ...(expiresAt ? { expiresAt } : {}),
      };
      const command = new TransactWriteItemsCommand({
        TransactItems: [
          logStatement,
          {
            Put: {
              TableName: genericConfig.ApiKeyTable,
              Item: marshall(apiKeyPayload),
              ConditionExpression: "attribute_not_exists(keyId)",
            },
          },
        ],
      });
      try {
        await fastify.dynamoClient.send(command);
      } catch (e) {
        if (e instanceof BaseError) {
          throw e;
        }
        fastify.log.error(e);
        throw new DatabaseInsertError({
          message: "Could not create API key.",
        });
      }
      return reply.status(201).send({
        apiKey,
        expiresAt,
      });
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().delete(
    "/org/:keyId",
    {
      schema: withRoles(
        [AppRoles.MANAGE_ORG_API_KEYS],
        withTags(["API Keys"], {
          summary: "Delete an organization API key.",
          params: z.object({
            keyId: z.string().min(1),
          }),
        }),
        { disableApiKeyAuth: true },
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      const { keyId } = request.params;
      const logStatement = buildAuditLogTransactPut({
        entry: {
          module: Modules.API_KEY,
          message: `Deleted API key.`,
          actor: request.username!,
          target: `acmuiuc_${keyId}`,
          requestId: request.id,
        },
      });
      const command = new TransactWriteItemsCommand({
        TransactItems: [
          logStatement,
          {
            Delete: {
              TableName: genericConfig.ApiKeyTable,
              Key: { keyId: { S: keyId } },
              ConditionExpression: "attribute_exists(keyId)",
            },
          },
        ],
      });
      try {
        await fastify.dynamoClient.send(command);
      } catch (e) {
        if (e instanceof BaseError) {
          throw e;
        }
        if (e instanceof ConditionalCheckFailedException) {
          throw new ValidationError({
            message: "Key does not exist.",
          });
        }
        fastify.log.error(e);
        throw new DatabaseDeleteError({
          message: "Could not delete API key.",
        });
      }
      return reply.status(204).send();
    },
  );
};

export default apiKeyRoute;
