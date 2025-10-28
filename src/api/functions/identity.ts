import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { ValidLoggers } from "api/types.js";
import { genericConfig } from "common/config.js";

export interface UserIdentity {
  id: string;
  uinHash?: string;
  netId?: string;
  firstName?: string;
  lastName?: string;
  stripeCustomerId?: string;
  updatedAt?: string;
}

export interface GetUserIdentityInputs {
  netId: string;
  dynamoClient: DynamoDBClient;
  logger: ValidLoggers;
}

export async function getUserIdentity({
  netId,
  dynamoClient,
  logger,
}: GetUserIdentityInputs): Promise<UserIdentity | null> {
  const userId = `${netId}@illinois.edu`;

  try {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: genericConfig.UserInfoTable,
        Key: {
          id: { S: userId },
        },
        ConsistentRead: true,
      }),
    );

    if (!result.Item) {
      logger.info(`No user found for netId: ${netId}`);
      return null;
    }
    return unmarshall(result.Item) as UserIdentity;
  } catch (error) {
    logger.error(`Error fetching user identity for ${netId}: ${error}`);
    throw error;
  }
}
