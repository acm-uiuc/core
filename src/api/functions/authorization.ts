import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { genericConfig } from "../../common/config.js";
import { DatabaseFetchError } from "../../common/errors/index.js";
import { allAppRoles, AppRoles } from "../../common/roles.js";
import { FastifyInstance } from "fastify";

export const AUTH_DECISION_CACHE_SECONDS = 180;

export async function getUserRoles(
  dynamoClient: DynamoDBClient,
  fastifyApp: FastifyInstance,
  userId: string,
): Promise<AppRoles[]> {
  const cachedValue = fastifyApp.nodeCache.get(`userroles-${userId}`);
  if (cachedValue) {
    fastifyApp.log.info(`Returning cached auth decision for user ${userId}`);
    return cachedValue as AppRoles[];
  }
  const tableName = `${genericConfig["IAMTablePrefix"]}-userroles`;
  const command = new GetItemCommand({
    TableName: tableName,
    Key: {
      userEmail: { S: userId },
    },
  });
  const response = await dynamoClient.send(command);
  if (!response || !response.Item) {
    throw new DatabaseFetchError({
      message: "Could not get user roles",
    });
  }
  const items = unmarshall(response.Item) as { roles: AppRoles[] | ["all"] };
  if (!("roles" in items)) {
    return [];
  }
  if (items["roles"][0] === "all") {
    fastifyApp.nodeCache.set(
      `userroles-${userId}`,
      allAppRoles,
      AUTH_DECISION_CACHE_SECONDS,
    );
    return allAppRoles;
  }
  fastifyApp.nodeCache.set(
    `userroles-${userId}`,
    items["roles"],
    AUTH_DECISION_CACHE_SECONDS,
  );
  return items["roles"] as AppRoles[];
}

export async function getGroupRoles(
  dynamoClient: DynamoDBClient,
  fastifyApp: FastifyInstance,
  groupId: string,
) {
  const cachedValue = fastifyApp.nodeCache.get(`grouproles-${groupId}`);
  if (cachedValue) {
    fastifyApp.log.info(`Returning cached auth decision for group ${groupId}`);
    return cachedValue as AppRoles[];
  }
  const tableName = `${genericConfig["IAMTablePrefix"]}-grouproles`;
  const command = new GetItemCommand({
    TableName: tableName,
    Key: {
      groupUuid: { S: groupId },
    },
  });
  const response = await dynamoClient.send(command);
  if (!response) {
    throw new DatabaseFetchError({
      message: "Could not get group roles for user",
    });
  }
  if (!response.Item) {
    fastifyApp.nodeCache.set(
      `grouproles-${groupId}`,
      [],
      AUTH_DECISION_CACHE_SECONDS,
    );
    return [];
  }
  const items = unmarshall(response.Item) as { roles: AppRoles[] | ["all"] };
  if (!("roles" in items)) {
    fastifyApp.nodeCache.set(
      `grouproles-${groupId}`,
      [],
      AUTH_DECISION_CACHE_SECONDS,
    );
    return [];
  }
  if (items["roles"][0] === "all") {
    fastifyApp.nodeCache.set(
      `grouproles-${groupId}`,
      allAppRoles,
      AUTH_DECISION_CACHE_SECONDS,
    );
    return allAppRoles;
  }
  fastifyApp.nodeCache.set(
    `grouproles-${groupId}`,
    items["roles"],
    AUTH_DECISION_CACHE_SECONDS,
  );
  return items["roles"] as AppRoles[];
}
