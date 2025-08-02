import { FastifyPluginAsync } from "fastify";
import rateLimiter from "api/plugins/rateLimiter.js";
import { withRoles, withTags } from "api/components/index.js";
import { AppRoles } from "common/roles.js";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import { apiKeyPostBody } from "common/types/apiKey.js";
import { createApiKey, ApiKeyDynamoEntry } from "api/functions/apiKey.js";
import { buildAuditLogTransactPut } from "api/functions/auditLog.js";
import { Modules } from "common/modules.js";
import { genericConfig } from "common/config.js";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  ConditionalCheckFailedException,
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import {
  BaseError,
  DatabaseDeleteError,
  DatabaseFetchError,
  DatabaseInsertError,
  ValidationError,
} from "common/errors/index.js";
import * as z from "zod/v4";
import { AvailableSQSFunctions, SQSPayload } from "common/types/sqsMessage.js";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

const apiKeyRoute: FastifyPluginAsync = async (fastify, _options) => {
  await fastify.register(rateLimiter, {
    limit: 15,
    duration: 30,
    rateLimitIdentifier: "apiKey",
  });
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/org",
    {
      schema: withRoles(
        [AppRoles.MANAGE_ORG_API_KEYS],
        withTags(["API Keys"], {
          summary: "Create an organization API key.",
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
          ...(logStatement ? [logStatement] : []),
          {
            Put: {
              TableName: genericConfig.ApiKeyTable,
              Item: marshall(apiKeyPayload, { removeUndefinedValues: true }),
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
      request.log.debug("Constructing SQS payload to send email notification.");
      const sqsPayload: SQSPayload<AvailableSQSFunctions.EmailNotifications> = {
        function: AvailableSQSFunctions.EmailNotifications,
        metadata: {
          initiator: request.username!,
          reqId: request.id,
        },
        payload: {
          to: [request.username!],
          subject: "Important: API Key Created",
          content: `
This email confirms that an API key for the Core API has been generated from your account.

Key ID: acmuiuc_${keyId}

Key Description: ${description}

IP address: ${request.ip}
${request.location.city && request.location.region && request.location.country ? `\nLocation: ${request.location.city}, ${request.location.region}, ${request.location.country}\n` : ""}
Roles: ${roles.join(", ")}.

If you did not create this API key, please secure your account and notify the ACM Infrastructure team.
          `,
          callToActionButton: {
            name: "View API Keys",
            url: `${fastify.environmentConfig.UserFacingUrl}/login?returnTo=%2FapiKeys`,
          },
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
          MessageGroupId: "securityNotification",
        }),
      );
      if (result.MessageId) {
        request.log.info(`Queued notification with ID ${result.MessageId}.`);
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
            keyId: z.string().min(1).meta({
              description:
                "Key ID to delete. The key ID is the second segment of the API key.",
            }),
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
          ...(logStatement ? [logStatement] : []),
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
      request.log.debug("Constructing SQS payload to send email notification.");
      const sqsPayload: SQSPayload<AvailableSQSFunctions.EmailNotifications> = {
        function: AvailableSQSFunctions.EmailNotifications,
        metadata: {
          initiator: request.username!,
          reqId: request.id,
        },
        payload: {
          to: [request.username!],
          subject: "Important: API Key Deleted",
          content: `
This email confirms that an API key for the Core API has been deleted from your account.

Key ID: acmuiuc_${keyId}

IP address: ${request.ip}.
${request.location.city && request.location.region && request.location.country ? `\nLocation: ${request.location.city}, ${request.location.region}, ${request.location.country}\n` : ""}
If you did not delete this API key, please secure your account and notify the ACM Infrastructure team.
          `,
          callToActionButton: {
            name: "View API Keys",
            url: `${fastify.environmentConfig.UserFacingUrl}/login?returnTo=%2FapiKeys`,
          },
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
          MessageGroupId: "securityNotification",
        }),
      );
      if (result.MessageId) {
        request.log.info(`Queued notification with ID ${result.MessageId}.`);
      }
      return reply.status(204).send();
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/org",
    {
      schema: withRoles(
        [AppRoles.MANAGE_ORG_API_KEYS],
        withTags(["API Keys"], {
          summary: "Get all organization API keys.",
        }),
        { disableApiKeyAuth: true },
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      const command = new ScanCommand({
        TableName: genericConfig.ApiKeyTable,
      });
      try {
        const result = await fastify.dynamoClient.send(command);
        if (!result || !result.Items) {
          throw new DatabaseFetchError({
            message: "Could not fetch API keys.",
          });
        }
        const unmarshalled = result.Items.map((x) =>
          unmarshall(x),
        ) as ApiKeyDynamoEntry[];
        const filtered = unmarshalled
          .map((x) => ({
            ...x,
            keyHash: undefined,
          }))
          .filter((x) => !x.expiresAt || x.expiresAt < Date.now());
        return reply.status(200).send(filtered);
      } catch (e) {
        if (e instanceof BaseError) {
          throw e;
        }
        fastify.log.error(e);
        throw new DatabaseFetchError({
          message: "Could not fetch API keys.",
        });
      }
    },
  );
};

export default apiKeyRoute;
