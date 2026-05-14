import { BatchGetItemCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { ValidLoggers } from "api/types.js";
import { genericConfig } from "common/config.js";
import { MemberBannedError } from "common/errors/index.js";

export interface UserIdentity {
  id: string;
  uin?: string;
  netId?: string;
  firstName?: string;
  lastName?: string;
  stripeCustomerId?: string;
  updatedAt?: string;
  // If the user is banned, the epoch time in seconds until when they are banned.
  bannedUntil?: number;
}

export interface GetUserIdentityInputs {
  netId: string;
  dynamoClient: DynamoDBClient;
  logger: ValidLoggers;
  enforceUserBan?: boolean;
}

export async function getUserIdentity({
  netId,
  dynamoClient,
  logger,
  enforceUserBan = true,
}: GetUserIdentityInputs): Promise<UserIdentity | null> {
  const userId = `${netId}@illinois.edu`;
  const uinKey = `UIN#${netId}@illinois.edu`;

  try {
    const result = await dynamoClient.send(
      new BatchGetItemCommand({
        RequestItems: {
          [genericConfig.UserInfoTable]: {
            Keys: [{ id: { S: userId } }, { id: { S: uinKey } }],
            ConsistentRead: true,
          },
        },
      }),
    );

    const items = result.Responses?.[genericConfig.UserInfoTable] || [];

    const userItem = items.find((item) => item.id?.S === userId);
    const uinItem = items.find((item) => item.id?.S === uinKey);

    if (!userItem) {
      logger.info(`No user found for netId: ${netId}`);
      return null;
    }

    const userIdentity = unmarshall(userItem) as UserIdentity;

    if (uinItem) {
      userIdentity.uin = unmarshall(uinItem).uin;
    }

    if (
      enforceUserBan &&
      userIdentity.bannedUntil &&
      userIdentity.bannedUntil > Date.now()
    ) {
      throw new MemberBannedError({ bannedUntil: userIdentity.bannedUntil });
    }

    return userIdentity;
  } catch (error) {
    logger.error(`Error fetching user identity for ${netId}: ${error}`);
    throw error;
  }
}
