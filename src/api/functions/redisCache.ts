import type RedisModule from "ioredis";
import type pino from "pino";
import { type FastifyBaseLogger } from "fastify";

export type GetFromCacheInput = {
  redisClient: RedisModule.default;
  key: string;
  logger: pino.Logger | FastifyBaseLogger;
};

export type SetInCacheInput = {
  redisClient: RedisModule.default;
  key: string;
  data: string;
  expiresIn?: number;
  logger: pino.Logger | FastifyBaseLogger;
};

export async function getKey<T extends object>({
  redisClient,
  key,
  logger,
}: GetFromCacheInput): Promise<T | null> {
  logger.debug(`Getting redis key "${key}".`);
  const data = await redisClient.get(key);
  if (!data) {
    return null;
  }
  return JSON.parse(data) as T;
}

export async function setKey({
  redisClient,
  key,
  data,
  expiresIn,
  logger,
}: SetInCacheInput) {
  const strRedisPayload = data;
  logger.debug(`Setting redis key "${key}".`);
  return expiresIn
    ? await redisClient.set(key, strRedisPayload, "EX", expiresIn)
    : await redisClient.set(key, strRedisPayload);
}
