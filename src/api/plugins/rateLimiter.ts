import fp from "fastify-plugin";
import {
  ConditionalCheckFailedException,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { genericConfig } from "common/config.js";
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";

interface RateLimiterOptions {
  limit?: number | ((request: FastifyRequest) => number);
  duration?: number;
  rateLimitIdentifier?: string;
}

interface RateLimitParams {
  ddbClient: DynamoDBClient;
  rateLimitIdentifier: string;
  duration: number;
  limit: number;
  userIdentifier: string;
}

async function isAtLimit({
  ddbClient,
  rateLimitIdentifier,
  duration,
  limit,
  userIdentifier,
}: RateLimitParams): Promise<{
  limited: boolean;
  resetTime: number;
  used: number;
}> {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const timeWindow = Math.floor(nowInSeconds / duration) * duration;
  const PK = `rate-limit:${rateLimitIdentifier}:${userIdentifier}:${timeWindow}`;

  try {
    const result = await ddbClient.send(
      new UpdateItemCommand({
        TableName: genericConfig.RateLimiterDynamoTableName,
        Key: {
          PK: { S: PK },
          SK: { S: "counter" },
        },
        UpdateExpression: "ADD #rateLimitCount :inc SET #ttl = :ttl",
        ConditionExpression:
          "attribute_not_exists(#rateLimitCount) OR #rateLimitCount <= :limit",
        ExpressionAttributeValues: {
          ":inc": { N: "1" },
          ":limit": { N: limit.toString() },
          ":ttl": { N: (timeWindow + duration).toString() },
        },
        ExpressionAttributeNames: {
          "#rateLimitCount": "rateLimitCount",
          "#ttl": "ttl",
        },
        ReturnValues: "UPDATED_NEW",
        ReturnValuesOnConditionCheckFailure: "ALL_OLD",
      }),
    );
    return {
      limited: false,
      used: parseInt(result.Attributes?.rateLimitCount.N || "1", 10),
      resetTime: timeWindow + duration,
    };
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return { limited: true, resetTime: timeWindow + duration, used: limit };
    }
    throw error;
  }
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
