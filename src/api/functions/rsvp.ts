import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { batchGetItemChunked } from "api/utils.js";
import { genericConfig } from "common/config.js";
import type { ValidLoggers } from "api/types.js";

export async function getRsvpConfig({
  eventId,
  dynamoClient,
}: {
  eventId: string;
  dynamoClient: DynamoDBClient;
}) {
  const response = await dynamoClient.send(
    new GetItemCommand({
      TableName: genericConfig.RSVPDynamoTableName,
      Key: marshall({ partitionKey: `CONFIG#${eventId}` }),
    }),
  );
  return response.Item ? unmarshall(response.Item) : null;
}

export async function getRsvpConfigs({
  eventIds,
  dynamoClient,
  logger,
}: {
  eventIds: string[];
  dynamoClient: DynamoDBClient;
  logger: ValidLoggers;
}): Promise<Map<string, Record<string, unknown>>> {
  if (eventIds.length === 0) {
    return new Map();
  }
  const results = await batchGetItemChunked({
    keys: eventIds.map((id) => marshall({ partitionKey: `CONFIG#${id}` })),
    tableName: genericConfig.RSVPDynamoTableName,
    dynamoClient,
    logger,
    processItem: (raw) => unmarshall(raw),
  });
  const configs = new Map<string, Record<string, unknown>>();
  for (const config of results) {
    configs.set(config.partitionKey as string, config);
  }
  return configs;
}

export function isRsvpOpen(
  configItem: {
    rsvpOpenAt?: number;
    rsvpCloseAt?: number;
  } | null,
): boolean {
  if (!configItem) {
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  if (configItem.rsvpOpenAt && now < configItem.rsvpOpenAt) {
    return false;
  }
  if (configItem.rsvpCloseAt && now > configItem.rsvpCloseAt) {
    return false;
  }
  return true;
}
