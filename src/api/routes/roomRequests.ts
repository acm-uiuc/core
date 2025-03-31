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
import { randomUUID } from "crypto";

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
      const id = randomUUID().toString();
      reply.status(201).send({
        id,
        status: RoomRequestStatus.CREATED,
      });
    },
  );
};

export default roomRequestRoutes;
