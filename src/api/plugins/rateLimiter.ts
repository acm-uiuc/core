import fp from "fastify-plugin";
import { isAtLimit } from "api/functions/rateLimit.js";
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { getUserIdentifier } from "./auth.js";
import { ValidationError } from "common/errors/index.js";

interface RateLimiterOptions {
  limit?: number | ((request: FastifyRequest) => number);
  duration?: number;
  rateLimitIdentifier?: string | ((request: FastifyRequest) => string);
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
      const startTime = new Date().getTime();
      const userIdentifier = getUserIdentifier(request);
      if (!userIdentifier) {
        throw new ValidationError({
          message: "Could not find user identifier.",
        });
      }
      let computedLimit = limit;
      let computedIdentifier = rateLimitIdentifier;
      if (typeof computedLimit === "function") {
        computedLimit = computedLimit(request);
      }
      if (typeof computedIdentifier === "function") {
        computedIdentifier = computedIdentifier(request);
      }
      const { limited, resetTime, used } = await isAtLimit({
        redisClient: fastify.redisClient,
        rateLimitIdentifier: computedIdentifier,
        duration,
        limit: computedLimit,
        userIdentifier,
      });
      request.log.debug(
        `Computing rate limit took ${new Date().getTime() - startTime} ms.`,
      );
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
        request.log.info(
          {
            retryAfter,
          },
          "Request was blocked; caller has exceeded rate limit.",
        );
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
