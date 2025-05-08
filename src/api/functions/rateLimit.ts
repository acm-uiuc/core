import { Redis } from "ioredis"; // Make sure you have ioredis installed (npm install ioredis)

interface RateLimitParams {
  redisClient: Redis;
  rateLimitIdentifier: string;
  duration: number;
  limit: number;
  userIdentifier: string;
}

interface RateLimitResult {
  limited: boolean;
  resetTime: number;
  used: number;
}

const LUA_SCRIPT_INCREMENT_AND_EXPIRE = `
  local count = redis.call("INCR", KEYS[1])
  -- If the count is 1, this means the key was just created by INCR (first request in this window).
  -- So, we set its expiration time to the end of the current window.
  if tonumber(count) == 1 then
    redis.call("EXPIREAT", KEYS[1], ARGV[1])
  end
  return count
`;

export async function isAtLimit({
  redisClient,
  rateLimitIdentifier,
  duration,
  limit,
  userIdentifier,
}: RateLimitParams): Promise<RateLimitResult> {
  if (duration <= 0) {
    throw new Error("Rate limit duration must be a positive number.");
  }
  if (limit < 0) {
    throw new Error("Rate limit must be a non-negative number.");
  }

  const nowInSeconds = Math.floor(Date.now() / 1000);
  const timeWindowStart = Math.floor(nowInSeconds / duration) * duration;
  const key = `rate-limit:${rateLimitIdentifier}:${userIdentifier}:${timeWindowStart}`;
  const expiryTimestamp = timeWindowStart + duration;

  const currentUsedCount = (await redisClient.eval(
    LUA_SCRIPT_INCREMENT_AND_EXPIRE,
    1, // Number of keys
    key, // KEYS[1]
    expiryTimestamp.toString(), // ARGV[1]
  )) as number; // The script returns the count, which is a number.
  const isLimited = currentUsedCount > limit;
  const resetTime = expiryTimestamp;

  return {
    limited: isLimited,
    resetTime,
    used: isLimited ? limit : currentUsedCount,
  };
}
