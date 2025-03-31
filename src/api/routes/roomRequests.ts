import { FastifyPluginAsync } from "fastify";
import rateLimiter from "api/plugins/rateLimiter.js";
import {
  RoomRequestFormValues,
  roomRequestPostResponse,
  roomRequestSchema,
  RoomRequestStatus,
} from "common/types/roomRequest.js";
import { AppRoles } from "common/roles.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  BaseError,
  DatabaseInsertError,
  InternalServerError,
} from "common/errors/index.js";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { genericConfig } from "common/config.js";
import { marshall } from "@aws-sdk/util-dynamodb";

const roomRequestRoutes: FastifyPluginAsync = async (fastify, _options) => {
  await fastify.register(rateLimiter, {
    limit: 5,
    duration: 30,
    rateLimitIdentifier: "roomRequests",
  });
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
      const body = { ...request.body, requestId, userId: request.username };
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
