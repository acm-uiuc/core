import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { genericConfig } from "../../common/config.js";
import {
  BaseError,
  DatabaseFetchError,
  InternalServerError,
} from "../../common/errors/index.js";
import {
  allAppRoles,
  AppRoles,
  OrgRoleDefinition,
} from "../../common/roles.js";
import type Redis from "ioredis";
import { AUTH_CACHE_PREFIX } from "api/plugins/auth.js";
import {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  type FastifyBaseLogger,
} from "fastify";
import { getUserOrgRoles } from "./organizations.js";
import { ValidLoggers } from "api/types.js";

export async function getUserRoles(
  dynamoClient: DynamoDBClient,
  userId: string,
  logger: FastifyBaseLogger,
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
  // get user org roles and return if they lead at least one org
  let baseRoles: AppRoles[];
  try {
    const orgRoles = await getUserOrgRoles({
      username: userId,
      dynamoClient,
      logger,
    });
    const leadsOneOrg = orgRoles.filter((x) => x.role === "LEAD").length > 0;
    baseRoles = leadsOneOrg ? [AppRoles.AT_LEAST_ONE_ORG_MANAGER] : [];
  } catch (e) {
    logger.error(e);
    baseRoles = [];
  }

  if (!response.Item) {
    return baseRoles;
  }
  const items = unmarshall(response.Item) as { roles: AppRoles[] | ["all"] };
  if (!("roles" in items)) {
    return baseRoles;
  }
  if (items.roles[0] === "all") {
    return allAppRoles;
  }

  return [...new Set([...baseRoles, ...items.roles])] as AppRoles[];
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
  logger: ValidLoggers;
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

type AuthConfig = {
  validRoles: OrgRoleDefinition[];
};

/**
 * Authorizes a request by checking if the user has at least one of the specified organization roles.
 * This function can be used as a preHandler in Fastify routes.
 *
 * @param fastify The Fastify instance.
 * @param request The Fastify request object.
 * @param reply The Fastify reply object.
 * @param config An object containing an array of valid OrgRoleDefinition instances.
 */
export async function authorizeByOrgRoleOrSchema(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  config: AuthConfig,
) {
  let originalError = new InternalServerError({
    message: "You do not have permission to perform this action.",
  });

  try {
    await fastify.authorizeFromSchema(request, reply);
    return;
  } catch (e) {
    if (e instanceof BaseError) {
      originalError = e;
    } else {
      throw e;
    }
  }

  if (!request.username) {
    throw originalError;
  }

  const userRoles = await getUserOrgRoles({
    username: request.username,
    dynamoClient: fastify.dynamoClient,
    logger: request.log,
  });

  const isAuthorized = userRoles.some((userRole) =>
    config.validRoles.some(
      (validRole) =>
        userRole.org === validRole.org && userRole.role === validRole.role,
    ),
  );

  if (!isAuthorized) {
    throw originalError;
  }
}
