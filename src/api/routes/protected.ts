import { FastifyPluginAsync } from "fastify";
import rateLimiter from "api/plugins/rateLimiter.js";
import { withRoles, withTags } from "api/components/index.js";

const protectedRoute: FastifyPluginAsync = async (fastify, _options) => {
  await fastify.register(rateLimiter, {
    limit: 15,
    duration: 30,
    rateLimitIdentifier: "protected",
  });
  fastify.get(
    "",
    {
      schema: withRoles(
        [],
        withTags(["Generic"], {
          summary: "Get a user's username and roles.",
        }),
      ),
    },
    async (request, reply) => {
      const roles = await fastify.authorize(request, reply, [], false);
      reply.send({ username: request.username, roles: Array.from(roles) });
    },
  );
};

export default protectedRoute;
