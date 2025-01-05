import { FastifyPluginAsync } from "fastify";
import fastifyCaching from "@fastify/caching";

const protectedRoute: FastifyPluginAsync = async (fastify, _options) => {
  fastify.register(fastifyCaching, {
    privacy: fastifyCaching.privacy.PRIVATE,
    serverExpiresIn: 0,
    expiresIn: 60 * 60 * 2,
  });
  fastify.get("/", async (request, reply) => {
    const roles = await fastify.authorize(request, reply, []);
    reply.send({ username: request.username, roles: Array.from(roles) });
  });
};

export default protectedRoute;
