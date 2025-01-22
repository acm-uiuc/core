import { FastifyPluginAsync } from "fastify";
import { allAppRoles, AppRoles } from "../../common/roles.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  addToTenant,
  getEntraIdToken,
  listGroupMembers,
  modifyGroup,
} from "../functions/entraId.js";
import {
  BaseError,
  DatabaseFetchError,
  DatabaseInsertError,
  EntraGroupError,
  EntraInvitationError,
  InternalServerError,
  NotFoundError,
} from "../../common/errors/index.js";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { genericConfig } from "../../common/config.js";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  InviteUserPostRequest,
  invitePostRequestSchema,
  GroupMappingCreatePostRequest,
  groupMappingCreatePostSchema,
  entraActionResponseSchema,
  groupModificationPatchSchema,
  GroupModificationPatchRequest,
  EntraGroupActions,
  entraGroupMembershipListResponse,
} from "../../common/types/iam.js";
import {
  AUTH_DECISION_CACHE_SECONDS,
  getGroupRoles,
} from "api/functions/authorization.js";

const dynamoClient = new DynamoDBClient({
  region: genericConfig.AwsRegion,
});

const iamRoutes: FastifyPluginAsync = async (fastify, _options) => {
  fastify.get<{
    Body: undefined;
    Querystring: { groupId: string };
  }>(
    "/groups/:groupId/roles",
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
      try {
        const groupId = (request.params as Record<string, string>).groupId;
        const roles = await getGroupRoles(dynamoClient, fastify, groupId);
        return reply.send(roles);
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
    "/groups/:groupId/roles",
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
        fastify.nodeCache.set(
          `grouproles-${groupId}`,
          request.body.roles,
          AUTH_DECISION_CACHE_SECONDS,
        );
      } catch (e: unknown) {
        fastify.nodeCache.del(`grouproles-${groupId}`);
        if (e instanceof BaseError) {
          throw e;
        }

        request.log.error(e);
        throw new DatabaseInsertError({
          message: "Could not create group role mapping.",
        });
      }
      reply.send({ message: "OK" });
      request.log.info(
        { type: "audit", actor: request.username, target: groupId },
        `set target roles to ${request.body.roles.toString()}`,
      );
    },
  );
  fastify.post<{ Body: InviteUserPostRequest }>(
    "/inviteUsers",
    {
      schema: {
        response: { 202: zodToJsonSchema(entraActionResponseSchema) },
      },
      preValidation: async (request, reply) => {
        await fastify.zodValidateBody(request, reply, invitePostRequestSchema);
      },
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [AppRoles.IAM_INVITE_ONLY]);
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
          request.log.info(
            { type: "audit", actor: request.username, target: emails[i] },
            "invited user to Entra ID tenant.",
          );
          response.success.push({ email: emails[i] });
        } else {
          request.log.info(
            { type: "audit", actor: request.username, target: emails[i] },
            "failed to invite user to Entra ID tenant.",
          );
          if (result.reason instanceof EntraInvitationError) {
            response.failure.push({
              email: emails[i],
              message: result.reason.message,
            });
          } else {
            response.failure.push({
              email: emails[i],
              message: "An unknown error occurred.",
            });
          }
        }
      }
      reply.status(202).send(response);
    },
  );
  fastify.patch<{
    Body: GroupModificationPatchRequest;
    Querystring: { groupId: string };
  }>(
    "/groups/:groupId",
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
          groupModificationPatchSchema,
        );
      },
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [AppRoles.IAM_ADMIN]);
      },
    },
    async (request, reply) => {
      const groupId = (request.params as Record<string, string>).groupId;
      if (!groupId || groupId === "") {
        throw new NotFoundError({
          endpointName: request.url,
        });
      }
      if (genericConfig.ProtectedEntraIDGroups.includes(groupId)) {
        throw new EntraGroupError({
          code: 403,
          message:
            "This group is protected and cannot be modified by this service. You must log into Entra ID directly to modify this group.",
          group: groupId,
        });
      }
      const entraIdToken = await getEntraIdToken(
        fastify.environmentConfig.AadValidClientId,
      );
      const addResults = await Promise.allSettled(
        request.body.add.map((email) =>
          modifyGroup(entraIdToken, email, groupId, EntraGroupActions.ADD),
        ),
      );
      const removeResults = await Promise.allSettled(
        request.body.remove.map((email) =>
          modifyGroup(entraIdToken, email, groupId, EntraGroupActions.REMOVE),
        ),
      );
      const response: Record<string, Record<string, string>[]> = {
        success: [],
        failure: [],
      };
      for (let i = 0; i < addResults.length; i++) {
        const result = addResults[i];
        if (result.status === "fulfilled") {
          response.success.push({ email: request.body.add[i] });
          request.log.info(
            {
              type: "audit",
              actor: request.username,
              target: request.body.add[i],
            },
            `added target to group ID ${groupId}`,
          );
        } else {
          request.log.info(
            {
              type: "audit",
              actor: request.username,
              target: request.body.add[i],
            },
            `failed to add target to group ID ${groupId}`,
          );
          if (result.reason instanceof EntraGroupError) {
            response.failure.push({
              email: request.body.add[i],
              message: result.reason.message,
            });
          } else {
            response.failure.push({
              email: request.body.add[i],
              message: "An unknown error occurred.",
            });
          }
        }
      }
      for (let i = 0; i < removeResults.length; i++) {
        const result = removeResults[i];
        if (result.status === "fulfilled") {
          response.success.push({ email: request.body.remove[i] });
          request.log.info(
            {
              type: "audit",
              actor: request.username,
              target: request.body.remove[i],
            },
            `removed target from group ID ${groupId}`,
          );
        } else {
          request.log.info(
            {
              type: "audit",
              actor: request.username,
              target: request.body.add[i],
            },
            `failed to remove target from group ID ${groupId}`,
          );
          if (result.reason instanceof EntraGroupError) {
            response.failure.push({
              email: request.body.add[i],
              message: result.reason.message,
            });
          } else {
            response.failure.push({
              email: request.body.add[i],
              message: "An unknown error occurred.",
            });
          }
        }
      }
      reply.status(202).send(response);
    },
  );
  fastify.get<{
    Querystring: { groupId: string };
  }>(
    "/groups/:groupId",
    {
      schema: {
        response: { 200: zodToJsonSchema(entraGroupMembershipListResponse) },
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
      if (!groupId || groupId === "") {
        throw new NotFoundError({
          endpointName: request.url,
        });
      }
      if (genericConfig.ProtectedEntraIDGroups.includes(groupId)) {
        throw new EntraGroupError({
          code: 403,
          message:
            "This group is protected and cannot be read by this service. You must log into Entra ID directly to read this group.",
          group: groupId,
        });
      }
      const entraIdToken = await getEntraIdToken(
        fastify.environmentConfig.AadValidClientId,
      );
      const response = await listGroupMembers(entraIdToken, groupId);
      reply.status(200).send(response);
    },
  );
};

export default iamRoutes;
