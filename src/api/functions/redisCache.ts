import { type Redis } from "ioredis";

export async function getRedisKey<T>({
  redisClient,
  key,
  parseJson = false,
}: {
  redisClient: Redis;
  key: string;
  parseJson?: boolean;
}) {
  const resp = await redisClient.get(key);
  if (!resp) {
    return null;
  }
  return parseJson ? (JSON.parse(resp) as T) : (resp as string);
}

export async function setRedisKey({
  redisClient,
  key,
  value,
  expiresSec,
}: {
  redisClient: Redis;
  key: string;
  value: string;
  expiresSec?: number;
}) {
  if (expiresSec) {
    return await redisClient.set(key, value, "EX", expiresSec);
  }
  return await redisClient.set(key, value);
}
