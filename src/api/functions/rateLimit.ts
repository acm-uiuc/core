import {
  ConditionalCheckFailedException,
  UpdateItemCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { genericConfig } from "common/config.js";

interface RateLimitParams {
  ddbClient: DynamoDBClient;
  rateLimitIdentifier: string;
  duration: number;
  limit: number;
  userIdentifier: string;
}

export async function isAtLimit({
  ddbClient,
  rateLimitIdentifier,
  duration,
  limit,
  userIdentifier,
}: RateLimitParams): Promise<{
  limited: boolean;
  resetTime: number;
  used: number;
}> {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const timeWindow = Math.floor(nowInSeconds / duration) * duration;
  const PK = `rate-limit:${rateLimitIdentifier}:${userIdentifier}:${timeWindow}`;

  try {
    const result = await ddbClient.send(
      new UpdateItemCommand({
        TableName: genericConfig.RateLimiterDynamoTableName,
        Key: {
          PK: { S: PK },
          SK: { S: "counter" },
        },
        UpdateExpression: "ADD #rateLimitCount :inc SET #ttl = :ttl",
        ConditionExpression:
          "attribute_not_exists(#rateLimitCount) OR #rateLimitCount <= :limit",
        ExpressionAttributeValues: {
          ":inc": { N: "1" },
          ":limit": { N: limit.toString() },
          ":ttl": { N: (timeWindow + duration).toString() },
        },
        ExpressionAttributeNames: {
          "#rateLimitCount": "rateLimitCount",
          "#ttl": "ttl",
        },
        ReturnValues: "UPDATED_NEW",
        ReturnValuesOnConditionCheckFailure: "ALL_OLD",
      }),
    );
    return {
      limited: false,
      used: parseInt(result.Attributes?.rateLimitCount.N || "1", 10),
      resetTime: timeWindow + duration,
    };
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return { limited: true, resetTime: timeWindow + duration, used: limit };
    }
    throw error;
  }
}
