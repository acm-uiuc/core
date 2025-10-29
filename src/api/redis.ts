import RedisModule from "ioredis";
import { ValidLoggers } from "./types.js";

type RedisMode = "read-write" | "read-only" | "down";

async function checkRedisMode(url: string): Promise<RedisMode> {
  let testModule: RedisModule.default | null = null;
  try {
    testModule = new RedisModule.default(url);

    // Test connectivity
    await testModule.ping();

    // Test write capability
    const testKey = `health-check:${Date.now()}`;
    try {
      await testModule.set(testKey, "test", "EX", 1);
      return "read-write";
    } catch (writeError) {
      return "read-only";
    }
  } catch (error) {
    return "down";
  } finally {
    if (testModule) {
      await testModule.quit().catch(() => {});
    }
  }
}

export async function createRedisModule(
  primaryUrl: string,
  fallbackUrl: string,
  logger: ValidLoggers,
) {
  const primaryMode = await checkRedisMode(primaryUrl);

  if (primaryMode === "read-write") {
    logger.info("Using primary Redis in read-write mode");
    return new RedisModule.default(primaryUrl);
  }

  const fallbackMode = await checkRedisMode(fallbackUrl);

  if (fallbackMode === "read-write") {
    logger.warn(
      `Primary Redis is ${primaryMode}, using fallback in read-write mode`,
    );
    return new RedisModule.default(fallbackUrl);
  }

  if (primaryMode === "read-only") {
    logger.warn(
      "Both Redis instances are read-only. Using primary in read-only mode",
    );
    return new RedisModule.default(primaryUrl);
  }

  if (fallbackMode === "read-only") {
    logger.error("Primary Redis is down, using fallback in read-only mode");
    return new RedisModule.default(fallbackUrl);
  }

  logger.error(
    "Both primary and fallback Redis instances are down. Creating client on primary anyway.",
  );
  return new RedisModule.default(primaryUrl);
}
