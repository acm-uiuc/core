import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { genericConfig } from "../../common/config.js";
import { DatabaseFetchError } from "../../common/errors/index.js";
import { allAppRoles, AppRoles } from "../../common/roles.js";

export async function getUserRoles(
  dynamoClient: DynamoDBClient,
  userId: string,
): Promise<AppRoles[]> {
  const tableName = `${genericConfig.IAMTablePrefix}-userroles`;
  const command = new GetItemCommand({
    TableName: tableName,
    Key: {
      userEmail: { S: userId },
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
  const tableName = `${genericConfig.IAMTablePrefix}-grouproles`;
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
