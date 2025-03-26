import { FastifyPluginAsync } from "fastify";
import rateLimiter from "api/plugins/rateLimiter.js";

const protectedRoute: FastifyPluginAsync = async (fastify, _options) => {
  await fastify.register(rateLimiter, {
    limit: 15,
    duration: 30,
    rateLimitIdentifier: "protected",
  });
  fastify.get("/", async (request, reply) => {
    const roles = await fastify.authorize(request, reply, []);
    reply.send({ username: request.username, roles: Array.from(roles) });
  });
};

export default protectedRoute;
