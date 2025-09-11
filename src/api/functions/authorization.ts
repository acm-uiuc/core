import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { genericConfig } from "../../common/config.js";
import { DatabaseFetchError } from "../../common/errors/index.js";
import { allAppRoles, AppRoles } from "../../common/roles.js";
import type Redis from "ioredis";
import { AUTH_CACHE_PREFIX } from "api/plugins/auth.js";
import type pino from "pino";
import { type FastifyBaseLogger } from "fastify";

export async function getUserRoles(
  dynamoClient: DynamoDBClient,
  userId: string,
): Promise<AppRoles[]> {
  const tableName = `${genericConfig.IAMTablePrefix}-assignments`;
  const command = new GetItemCommand({
    TableName: tableName,
    Key: {
      id: { S: `USER#${userId}` },
    },
  });
  const response = await dynamoClient.send(command);
  if (!response) {
    throw new DatabaseFetchError({
      message: "Could not get user roles",
    });
  }
  if (!response.Item) {
    return [];
  }
  const items = unmarshall(response.Item) as { roles: AppRoles[] | ["all"] };
  if (!("roles" in items)) {
    return [];
  }
  if (items.roles[0] === "all") {
    return allAppRoles;
  }
  return items.roles as AppRoles[];
}

export async function getGroupRoles(
  dynamoClient: DynamoDBClient,
  groupId: string,
) {
  const tableName = `${genericConfig.IAMTablePrefix}-assignments`;
  const command = new GetItemCommand({
    TableName: tableName,
    Key: {
      id: { S: `GROUP#${groupId}` },
    },
  });
  const response = await dynamoClient.send(command);
  if (!response) {
    throw new DatabaseFetchError({
      message: "Could not get group roles for user",
    });
  }
  if (!response.Item) {
    return [];
  }
  const items = unmarshall(response.Item) as { roles: AppRoles[] | ["all"] };
  if (!("roles" in items)) {
    return [];
  }
  if (items.roles[0] === "all") {
    return allAppRoles;
  }
  return items.roles as AppRoles[];
}

type ClearAuthCacheInput = {
  redisClient: Redis.default;
  username: string[];
  logger: pino.Logger | FastifyBaseLogger;
};
export async function clearAuthCache({
  redisClient,
  username,
  logger,
}: ClearAuthCacheInput) {
  logger.debug(`Clearing auth cache for: ${JSON.stringify(username)}.`);
  const keys = (
    await Promise.all(
      username.map((x) => redisClient.keys(`${AUTH_CACHE_PREFIX}${x}*`)),
    )
  ).flat();
  if (keys.length === 0) {
    return 0;
  }
  const result = await redisClient.del(keys);
  logger.debug(`Cleared ${result} auth cache keys.`);
  return result;
}
