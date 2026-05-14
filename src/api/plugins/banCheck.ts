import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { checkUserBan } from "api/functions/membership.js";
import { getNetIdFromEmail } from "common/utils.js";

const banCheckPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", async (request) => {
    const { username } = request;
    if (!username) {
      return;
    }
    if (username.startsWith("acmuiuc_")) {
      return;
    }
    if (
      !username.endsWith("@illinois.edu") &&
      !username.endsWith("@acm.illinois.edu")
    ) {
      return;
    }
    if (!fastify.dynamoClient || !fastify.redisClient) {
      return;
    }

    await checkUserBan({
      netId: getNetIdFromEmail(username),
      dynamoClient: fastify.dynamoClient,
      redisClient: fastify.redisClient,
      logger: request.log,
    });
  });
};

export default fp(banCheckPlugin);
