import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
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
