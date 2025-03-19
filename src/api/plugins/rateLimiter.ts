import fp from "fastify-plugin";
import { isAtLimit } from "api/functions/rateLimit.js";
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";

interface RateLimiterOptions {
  limit?: number | ((request: FastifyRequest) => number);
  duration?: number;
  rateLimitIdentifier?: string;
}

const rateLimiterPlugin: FastifyPluginAsync<RateLimiterOptions> = async (
  fastify,
  options,
) => {
  const {
    limit = 10,
    duration = 60,
    rateLimitIdentifier = "api-request",
  } = options;
  fastify.addHook(
    "preHandler",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userIdentifier = request.ip;
      let computedLimit = limit;
      if (typeof computedLimit === "function") {
        computedLimit = computedLimit(request);
      }
      const { limited, resetTime, used } = await isAtLimit({
        ddbClient: fastify.dynamoClient,
        rateLimitIdentifier,
        duration,
        limit: computedLimit,
        userIdentifier,
      });
      reply.header("X-RateLimit-Limit", computedLimit.toString());
      reply.header("X-RateLimit-Reset", resetTime?.toString() || "0");
      reply.header(
        "X-RateLimit-Remaining",
        limited ? 0 : used ? computedLimit - used : computedLimit - 1,
      );
      if (limited) {
        const retryAfter = resetTime
          ? resetTime - Math.floor(Date.now() / 1000)
          : undefined;
        reply.header("Retry-After", retryAfter?.toString() || "0");
        return reply.status(429).send({
          error: true,
          name: "RateLimitExceededError",
          id: 409,
          message: "Rate limit exceeded.",
        });
      }
    },
  );
};

export default fp(rateLimiterPlugin, {
  name: "fastify-rate-limiter",
});
