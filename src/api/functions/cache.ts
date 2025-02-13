import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { genericConfig } from "../../common/config.js";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

export async function getItemFromCache(
  dynamoClient: DynamoDBClient,
  key: string,
): Promise<null | Record<string, string | number>> {
  const currentTime = Math.floor(Date.now() / 1000);
  const { Items } = await dynamoClient.send(
    new QueryCommand({
      TableName: genericConfig.CacheDynamoTableName,
      KeyConditionExpression: "#pk = :pk",
      FilterExpression: "#ea > :ea",
      ExpressionAttributeNames: {
        "#pk": "primaryKey",
        "#ea": "expireAt",
      },
      ExpressionAttributeValues: marshall({
        ":pk": key,
        ":ea": currentTime,
      }),
    }),
  );
  if (!Items || Items.length == 0) {
    return null;
  }
  const item = unmarshall(Items[0]);
  return item;
}

export async function insertItemIntoCache(
  dynamoClient: DynamoDBClient,
  key: string,
  value: Record<string, string | number>,
  expireAt: Date,
) {
  const item = {
    primaryKey: key,
    expireAt: Math.floor(expireAt.getTime() / 1000),
    ...value,
  };

  await dynamoClient.send(
    new PutItemCommand({
      TableName: genericConfig.CacheDynamoTableName,
      Item: marshall(item),
    }),
  );
}
