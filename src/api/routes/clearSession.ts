import { FastifyPluginAsync } from "fastify";
import rateLimiter from "api/plugins/rateLimiter.js";
import { withRoles, withTags } from "api/components/index.js";
import { clearAuthCache } from "api/functions/authorization.js";

const clearSessionPlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.register(rateLimiter, {
    limit: 10,
    duration: 30,
    rateLimitIdentifier: "clearSession",
  });
  fastify.post(
    "",
    {
      schema: withRoles(
        [],
        withTags(["Generic"], {
          summary: "Clear user's session (usually on logout).",
          hide: true,
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      reply.status(201).send();
      const username = [request.username!];
      const { redisClient } = fastify;
      const { log: logger } = fastify;
      await clearAuthCache({ redisClient, username, logger });
    },
  );
};

export default clearSessionPlugin;
