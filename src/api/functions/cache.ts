import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  UpdateItemCommand,
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
  if (!Items || Items.length === 0) {
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

export async function atomicIncrementCacheCounter(
  dynamoClient: DynamoDBClient,
  key: string,
  amount: number,
  returnOld: boolean = false,
  expiresAt?: number,
): Promise<number> {
  const response = await dynamoClient.send(
    new UpdateItemCommand({
      TableName: genericConfig.CacheDynamoTableName,
      Key: marshall(
        {
          primaryKey: key,
          expireAt: expiresAt,
        },
        { removeUndefinedValues: true },
      ),
      UpdateExpression: "ADD #counterValue :increment",
      ExpressionAttributeNames: {
        "#counterValue": "counterValue",
      },
      ExpressionAttributeValues: marshall({
        ":increment": amount,
      }),
      ReturnValues: returnOld ? "UPDATED_OLD" : "UPDATED_NEW",
    }),
  );

  if (!response.Attributes) {
    return returnOld ? 0 : amount;
  }

  const value = unmarshall(response.Attributes).counter;
  return typeof value === "number" ? value : 0;
}

export async function getCacheCounter(
  dynamoClient: DynamoDBClient,
  key: string,
  defaultValue: number = 0,
): Promise<number> {
  const response = await dynamoClient.send(
    new GetItemCommand({
      TableName: genericConfig.CacheDynamoTableName,
      Key: marshall({
        primaryKey: key,
      }),
      ProjectionExpression: "counterValue", // Only retrieve the value attribute
    }),
  );

  if (!response.Item) {
    return defaultValue;
  }

  const value = unmarshall(response.Item).counterValue;
  return typeof value === "number" ? value : defaultValue;
}

export async function deleteCacheCounter(
  dynamoClient: DynamoDBClient,
  key: string,
): Promise<number | null> {
  const params = {
    TableName: genericConfig.CacheDynamoTableName,
    Key: marshall({
      primaryKey: key,
    }),
    ReturnValue: "ALL_OLD",
  };

  const response = await dynamoClient.send(new DeleteItemCommand(params));

  if (response.Attributes) {
    const item = unmarshall(response.Attributes);
    const value = item.counterValue;
    return typeof value === "number" ? value : 0;
  }
  return null;
}
