import { FastifyPluginAsync } from "fastify";
import { OrganizationList } from "../../common/orgs.js";
import fastifyCaching from "@fastify/caching";
import rateLimiter from "api/plugins/rateLimiter.js";
import { withTags } from "api/components/index.js";

const organizationsPlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.register(fastifyCaching, {
    privacy: fastifyCaching.privacy.PUBLIC,
    serverExpiresIn: 60 * 60 * 4,
    expiresIn: 60 * 60 * 4,
  });
  fastify.register(rateLimiter, {
    limit: 60,
    duration: 60,
    rateLimitIdentifier: "organizations",
  });
  fastify.get(
    "/",
    { schema: withTags(["Generic"], {}) },
    async (request, reply) => {
      reply.send(OrganizationList);
    },
  );
};

export default organizationsPlugin;
