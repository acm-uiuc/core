import {
  BatchGetItemCommand,
  DynamoDBClient,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { genericConfig } from "common/config.js";

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
}: {
  eventIds: string[];
  dynamoClient: DynamoDBClient;
}): Promise<Map<string, Record<string, unknown>>> {
  if (eventIds.length === 0) {
    return new Map();
  }
  const response = await dynamoClient.send(
    new BatchGetItemCommand({
      RequestItems: {
        [genericConfig.RSVPDynamoTableName]: {
          Keys: eventIds.map((id) =>
            marshall({ partitionKey: `CONFIG#${id}` }),
          ),
        },
      },
    }),
  );
  const configs = new Map<string, Record<string, unknown>>();
  for (const raw of response.Responses?.[genericConfig.RSVPDynamoTableName] ??
    []) {
    const config = unmarshall(raw);
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
