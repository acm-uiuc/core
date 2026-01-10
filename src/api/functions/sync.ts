import {
  UpdateItemCommand,
  type DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { Redis, ValidLoggers } from "api/types.js";
import { genericConfig } from "common/config.js";
import { createLock, IoredisAdapter } from "redlock-universal";
import { createStripeCustomer } from "./stripe.js";
import { InternalServerError } from "common/errors/index.js";
import { unmarshall } from "@aws-sdk/util-dynamodb";

export interface SyncFullProfileInputs {
  netId: string;
  firstName: string;
  lastName: string;
  dynamoClient: DynamoDBClient;
  redisClient: Redis;
  stripeApiKey: string;
  logger: ValidLoggers;
}

export async function syncFullProfile({
  netId,
  firstName,
  lastName,
  dynamoClient,
  redisClient,
  stripeApiKey,
  logger,
}: SyncFullProfileInputs) {
  const lock = createLock({
    adapter: new IoredisAdapter(redisClient),
    key: `userSync:${netId}`,
    retryAttempts: 5,
    retryDelay: 300,
  });

  return await lock.using(async (signal) => {
    const userId = `${netId}@illinois.edu`;
    const updateResult = await dynamoClient.send(
      new UpdateItemCommand({
        TableName: genericConfig.UserInfoTable,
        Key: {
          id: { S: userId },
        },
        UpdateExpression:
          "SET #netId = :netId, #updatedAt = :updatedAt, #firstName = :firstName, #lastName = :lastName",
        ExpressionAttributeNames: {
          "#netId": "netId",
          "#updatedAt": "updatedAt",
          "#firstName": "firstName",
          "#lastName": "lastName",
        },
        ExpressionAttributeValues: {
          ":netId": { S: netId },
          ":firstName": { S: firstName },
          ":lastName": { S: lastName },
          ":updatedAt": { S: new Date().toISOString() },
        },
        ReturnValues: "ALL_NEW",
      }),
    );

    const stripeCustomerId = updateResult.Attributes?.stripeCustomerId?.S;

    if (!stripeCustomerId) {
      if (signal.aborted) {
        throw new InternalServerError({
          message:
            "Checked on lock before creating Stripe customer, we've lost the lock!",
        });
      }
      const newStripeCustomerId = await createStripeCustomer({
        email: userId,
        name: `${firstName} ${lastName}`,
        stripeApiKey,
      });
      logger.info(`Created new Stripe customer for ${userId}.`);
      const newInfo = await dynamoClient.send(
        new UpdateItemCommand({
          TableName: genericConfig.UserInfoTable,
          Key: {
            id: { S: userId },
          },
          UpdateExpression: "SET #stripeCustomerId = :stripeCustomerId",
          ExpressionAttributeNames: {
            "#stripeCustomerId": "stripeCustomerId",
          },
          ExpressionAttributeValues: {
            ":stripeCustomerId": { S: newStripeCustomerId },
          },
          ReturnValues: "ALL_NEW",
        }),
      );
      return newInfo && newInfo.Attributes
        ? unmarshall(newInfo.Attributes)
        : updateResult && updateResult.Attributes
          ? unmarshall(updateResult.Attributes)
          : undefined;
    }

    return updateResult && updateResult.Attributes
      ? unmarshall(updateResult.Attributes)
      : undefined;
  });
}
