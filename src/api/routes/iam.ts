import { FastifyPluginAsync } from "fastify";
import { AppRoles } from "../../roles.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { addToTenant, getEntraIdToken } from "../functions/entraId.js";
import {
  BaseError,
  DatabaseFetchError,
  DatabaseInsertError,
  EntraInvitationError,
  InternalServerError,
  NotFoundError,
} from "../../errors/index.js";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { genericConfig } from "../../config.js";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const invitePostRequestSchema = z.object({
  emails: z.array(z.string()),
});
export type InviteUserPostRequest = z.infer<typeof invitePostRequestSchema>;

const groupMappingCreatePostSchema = z.object({
  roles: z
    .array(z.nativeEnum(AppRoles))
    .min(1)
    .refine((items) => new Set(items).size === items.length, {
      message: "All roles must be unique, no duplicate values allowed",
    }),
});

export type GroupMappingCreatePostRequest = z.infer<
  typeof groupMappingCreatePostSchema
>;

const invitePostResponseSchema = zodToJsonSchema(
  z.object({
    success: z.array(z.object({ email: z.string() })).optional(),
    failure: z
      .array(z.object({ email: z.string(), message: z.string() }))
      .optional(),
  }),
);

const dynamoClient = new DynamoDBClient({
  region: genericConfig.AwsRegion,
});

const iamRoutes: FastifyPluginAsync = async (fastify, _options) => {
  fastify.get<{
    Body: undefined;
    Querystring: { groupId: string };
  }>(
    "/groupRoles/:groupId",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            groupId: {
              type: "string",
            },
          },
        },
      },
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [AppRoles.IAM_ADMIN]);
      },
    },
    async (request, reply) => {
      const groupId = (request.params as Record<string, string>).groupId;
      try {
        const command = new GetItemCommand({
          TableName: `${genericConfig.IAMTablePrefix}-grouproles`,
          Key: { groupUuid: { S: groupId } },
        });
        const response = await dynamoClient.send(command);
        if (!response.Item) {
          throw new NotFoundError({
            endpointName: `/api/v1/iam/groupRoles/${groupId}`,
          });
        }
        reply.send(unmarshall(response.Item));
      } catch (e: unknown) {
        if (e instanceof BaseError) {
          throw e;
        }

        request.log.error(e);
        throw new DatabaseFetchError({
          message: "An error occurred finding the group role mapping.",
        });
      }
    },
  );
  fastify.post<{
    Body: GroupMappingCreatePostRequest;
    Querystring: { groupId: string };
  }>(
    "/groupRoles/:groupId",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            groupId: {
              type: "string",
            },
          },
        },
      },
      preValidation: async (request, reply) => {
        await fastify.zodValidateBody(
          request,
          reply,
          groupMappingCreatePostSchema,
        );
      },
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [AppRoles.IAM_ADMIN]);
      },
    },
    async (request, reply) => {
      const groupId = (request.params as Record<string, string>).groupId;
      try {
        const timestamp = new Date().toISOString();
        const command = new PutItemCommand({
          TableName: `${genericConfig.IAMTablePrefix}-grouproles`,
          Item: marshall({
            groupUuid: groupId,
            roles: request.body.roles,
            createdAt: timestamp,
          }),
        });

        await dynamoClient.send(command);
      } catch (e: unknown) {
        if (e instanceof BaseError) {
          throw e;
        }

        request.log.error(e);
        throw new DatabaseInsertError({
          message: "Could not create group role mapping.",
        });
      }
      reply.send({ message: "OK" });
    },
  );
  fastify.post<{ Body: InviteUserPostRequest }>(
    "/inviteUsers",
    {
      schema: {
        response: { 200: invitePostResponseSchema },
      },
      preValidation: async (request, reply) => {
        await fastify.zodValidateBody(request, reply, invitePostRequestSchema);
      },
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [AppRoles.SSO_INVITE_USER]);
      },
    },
    async (request, reply) => {
      const emails = request.body.emails;
      const entraIdToken = await getEntraIdToken(
        fastify.environmentConfig.AadValidClientId,
      );
      if (!entraIdToken) {
        throw new InternalServerError({
          message: "Could not get Entra ID token to perform task.",
        });
      }
      const response: Record<string, Record<string, string>[]> = {
        success: [],
        failure: [],
      };
      const results = await Promise.allSettled(
        emails.map((email) => addToTenant(entraIdToken, email)),
      );
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === "fulfilled") {
          response.success.push({ email: emails[i] });
        } else {
          if (result.reason instanceof EntraInvitationError) {
            response.failure.push({
              email: emails[i],
              message: result.reason.message,
            });
          }
        }
      }
      let statusCode = 201;
      if (response.success.length === 0) {
        statusCode = 500;
      }
      reply.status(statusCode).send(response);
    },
  );
};

export default iamRoutes;
