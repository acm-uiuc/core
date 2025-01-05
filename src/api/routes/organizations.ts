import { FastifyPluginAsync } from "fastify";
import { OrganizationList } from "../../orgs.js";
import fastifyCaching from "@fastify/caching";

const organizationsPlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.register(fastifyCaching, {
    privacy: fastifyCaching.privacy.PUBLIC,
    serverExpiresIn: 60 * 60 * 4,
    expiresIn: 60 * 60 * 4,
  });
  fastify.get("/", {}, async (request, reply) => {
    reply.send(OrganizationList);
  });
};

export default organizationsPlugin;
