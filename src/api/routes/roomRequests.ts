import { FastifyPluginAsync } from "fastify";
import rateLimiter from "api/plugins/rateLimiter.js";
import {
  roomRequestBaseSchema,
  RoomRequestFormValues,
  roomRequestPostResponse,
  roomRequestSchema,
  RoomRequestStatus,
  RoomRequestStatusUpdatePostBody,
  roomRequestStatusUpdateRequest,
} from "common/types/roomRequest.js";
import { AppRoles } from "common/roles.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  BaseError,
  DatabaseFetchError,
  DatabaseInsertError,
  InternalServerError,
} from "common/errors/index.js";
import { PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { genericConfig } from "common/config.js";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";

const roomRequestRoutes: FastifyPluginAsync = async (fastify, _options) => {
  await fastify.register(rateLimiter, {
    limit: 20,
    duration: 30,
    rateLimitIdentifier: "roomRequests",
  });
  fastify.post<{
    Body: RoomRequestStatusUpdatePostBody;
    Params: { requestId: string; semesterId: string };
  }>(
    "/:semesterId/:requestId/status",
    {
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [AppRoles.ROOM_REQUEST_UPDATE]);
      },
      preValidation: async (request, reply) => {
        await fastify.zodValidateBody(
          request,
          reply,
          roomRequestStatusUpdateRequest,
        );
      },
    },
    async (request, reply) => {
      const requestId = request.params.requestId;
      const semesterId = request.params.semesterId;
      const createdAt = new Date().toISOString();
      const command = new PutItemCommand({
        TableName: genericConfig.RoomRequestsStatusTableName,
        Item: marshall({
          requestId,
          semesterId,
          "createdAt#status": `${createdAt}#${request.body.status}`,
          createdBy: request.username,
          ...request.body,
        }),
      });
      try {
        await fastify.dynamoClient.send(command);
      } catch (e) {
        request.log.error(e);
        if (e instanceof BaseError) {
          throw e;
        }
        throw new DatabaseInsertError({
          message: "Could not save status update.",
        });
      }
      return reply.status(201);
    },
  );
  fastify.get<{
    Body: undefined;
    Params: { semesterId: string };
  }>(
    "/:semesterId",
    {
      schema: {
        response: {
          200: zodToJsonSchema(
            z.array(
              roomRequestBaseSchema.extend({ requestId: z.string().uuid() }),
            ),
          ),
        },
      },
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [AppRoles.ROOM_REQUEST_CREATE]);
      },
    },
    async (request, reply) => {
      const semesterId = request.params.semesterId;
      if (!request.username) {
        throw new InternalServerError({
          message: "Could not retrieve username.",
        });
      }
      let command: QueryCommand;
      if (request.userRoles?.has(AppRoles.BYPASS_OBJECT_LEVEL_AUTH)) {
        command = new QueryCommand({
          TableName: genericConfig.RoomRequestsTableName,
          KeyConditionExpression: "semesterId = :semesterValue",
          ExpressionAttributeValues: {
            ":semesterValue": { S: semesterId },
          },
        });
      } else {
        command = new QueryCommand({
          TableName: genericConfig.RoomRequestsTableName,
          KeyConditionExpression: "semesterId = :semesterValue",
          FilterExpression: "begins_with(#hashKey, :username)",
          ExpressionAttributeNames: {
            "#hashKey": "userId#requestId",
          },
          ProjectionExpression: "requestId, host, title",
          ExpressionAttributeValues: {
            ":semesterValue": { S: semesterId },
            ":username": { S: request.username },
          },
        });
      }
      const response = await fastify.dynamoClient.send(command);
      if (!response.Items) {
        throw new DatabaseFetchError({
          message: "Could not get room requests.",
        });
      }
      const items = response.Items.map((x) => unmarshall(x));
      return reply.status(200).send(items);
    },
  );
  fastify.post<{ Body: RoomRequestFormValues }>(
    "/",
    {
      schema: {
        response: { 201: zodToJsonSchema(roomRequestPostResponse) },
      },
      preValidation: async (request, reply) => {
        await fastify.zodValidateBody(request, reply, roomRequestSchema);
      },
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [AppRoles.ROOM_REQUEST_CREATE]);
      },
    },
    async (request, reply) => {
      const requestId = request.id;
      if (!request.username) {
        throw new InternalServerError({
          message: "Could not retrieve username.",
        });
      }
      const body = {
        ...request.body,
        requestId,
        userId: request.username,
        "userId#requestId": `${request.username}#${requestId}`,
        semesterId: request.body.semester,
      };
      try {
        await fastify.dynamoClient.send(
          new PutItemCommand({
            TableName: genericConfig.RoomRequestsTableName,
            Item: marshall(body),
          }),
        );
      } catch (e) {
        if (e instanceof BaseError) {
          throw e;
        }
        request.log.error(e);
        throw new DatabaseInsertError({
          message: "Could not save room request.",
        });
      }
      reply.status(201).send({
        id: requestId,
        status: RoomRequestStatus.CREATED,
      });
    },
  );
};

export default roomRequestRoutes;
