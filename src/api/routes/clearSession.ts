import { FastifyPluginAsync } from "fastify";
import rateLimiter from "api/plugins/rateLimiter.js";
import { withRoles, withTags } from "api/components/index.js";
import { clearAuthCache } from "api/functions/authorization.js";
import { setKey } from "api/functions/redisCache.js";

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
      if (!request.tokenPayload) {
        return;
      }
      const now = Date.now() / 1000;
      const tokenExpiry = request.tokenPayload.exp;
      const expiresIn = Math.ceil(tokenExpiry - now);
      const tokenId = request.tokenPayload.uti;
      // if the token expires more than 10 seconds after now, add to a revoke list
      if (expiresIn > 10) {
        await setKey({
          redisClient,
          key: `tokenRevocationList:${tokenId}`,
          data: JSON.stringify({ isInvalid: true }),
          logger,
          expiresIn,
        });
      }
    },
  );
};

export default clearSessionPlugin;
