import {
  BatchGetItemCommand,
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { ValidLoggers } from "api/types.js";
import { retryDynamoTransactionWithBackoff } from "api/utils.js";
import { argon2id, hash } from "argon2";
import { genericConfig } from "common/config.js";
import {
  BaseError,
  DatabaseFetchError,
  EntraFetchError,
  InternalServerError,
  UnauthenticatedError,
  ValidationError,
} from "common/errors/index.js";
import { type FastifyBaseLogger } from "fastify";

export type HashUinInputs = {
  pepper: string;
  uin: string;
};

export type GetUserUinInputs = {
  uiucAccessToken: string;
  pepper: string;
};

export const verifyUiucAccessToken = async ({
  accessToken,
  logger,
}: {
  accessToken: string | string[] | undefined;
  logger: FastifyBaseLogger;
}) => {
  if (!accessToken) {
    throw new UnauthenticatedError({
      message: "Access token not found.",
    });
  }
  if (Array.isArray(accessToken)) {
    throw new ValidationError({
      message: "Multiple tokens cannot be specified!",
    });
  }
  const url =
    "https://graph.microsoft.com/v1.0/me?$select=userPrincipalName,givenName,surname,mail";

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (response.status === 401) {
      const errorText = await response.text();
      logger.warn(`Microsoft Graph API unauthenticated response: ${errorText}`);
      throw new UnauthenticatedError({
        message: "Invalid or expired access token.",
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        `Microsoft Graph API error: ${response.status} - ${errorText}`,
      );
      throw new InternalServerError({
        message: "Failed to contact Microsoft Graph API.",
      });
    }

    const data = (await response.json()) as {
      userPrincipalName: string;
      givenName: string;
      surname: string;
      mail: string;
    };
    logger.info("Access token successfully verified with Microsoft Graph API.");
    return data;
  } catch (error) {
    if (error instanceof BaseError) {
      throw error;
    } else {
      logger.error(error);
      throw new InternalServerError({
        message:
          "An unexpected error occurred during access token verification.",
      });
    }
  }
};

export async function getUinHash({
  pepper,
  uin,
}: HashUinInputs): Promise<string> {
  // we set the defaults again because we do direct string comparisions
  return hash(uin, {
    secret: Buffer.from(pepper),
    hashLength: 32,
    timeCost: 3,
    memoryCost: 65536,
    parallelism: 4,
    type: argon2id,
    version: 19,
    salt: Buffer.from("acmuiucuin"),
  });
}

export async function getHashedUserUin({
  uiucAccessToken,
  pepper,
}: GetUserUinInputs): Promise<string> {
  const url = `https://graph.microsoft.com/v1.0/me?$select=${genericConfig.UinExtendedAttributeName}`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${uiucAccessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new EntraFetchError({
        message: "Failed to get user's UIN.",
        email: "",
      });
    }

    const data = (await response.json()) as {
      [genericConfig.UinExtendedAttributeName]: string;
    };

    return await getUinHash({
      pepper,
      uin: data[genericConfig.UinExtendedAttributeName],
    });
  } catch (error) {
    if (error instanceof EntraFetchError) {
      throw error;
    }

    throw new EntraFetchError({
      message: "Failed to fetch user UIN.",
      email: "",
    });
  }
}

type SaveHashedUserUin = GetUserUinInputs & {
  dynamoClient: DynamoDBClient;
  netId: string;
};

export async function saveHashedUserUin({
  uiucAccessToken,
  pepper,
  dynamoClient,
  netId,
}: SaveHashedUserUin) {
  const uinHash = await getHashedUserUin({ uiucAccessToken, pepper });
  await dynamoClient.send(
    new UpdateItemCommand({
      TableName: genericConfig.UserInfoTable,
      Key: {
        id: { S: `${netId}@illinois.edu` },
      },
      UpdateExpression:
        "SET #uinHash = :uinHash, #netId = :netId, #updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#uinHash": "uinHash",
        "#netId": "netId",
        "#updatedAt": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":uinHash": { S: uinHash },
        ":netId": { S: netId },
        ":updatedAt": { S: new Date().toISOString() },
      },
    }),
  );
}

export async function getUserIdByUin({
  dynamoClient,
  uin,
  pepper,
}: {
  dynamoClient: DynamoDBClient;
  uin: string;
  pepper: string;
}): Promise<{ id: string }> {
  const uinHash = await getUinHash({
    pepper,
    uin,
  });

  const queryCommand = new QueryCommand({
    TableName: genericConfig.UserInfoTable,
    IndexName: "UinHashIndex",
    KeyConditionExpression: "uinHash = :hash",
    ExpressionAttributeValues: {
      ":hash": { S: uinHash },
    },
  });

  const response = await dynamoClient.send(queryCommand);

  if (!response || !response.Items) {
    throw new DatabaseFetchError({
      message: "Failed to retrieve user from database.",
    });
  }

  if (response.Items.length === 0) {
    throw new ValidationError({
      message:
        "Failed to find user in database. Please have the user run sync and try again.",
    });
  }

  if (response.Items.length > 1) {
    throw new ValidationError({
      message:
        "Multiple users tied to this UIN. This user probably had a NetID change. Please contact support.",
    });
  }

  const data = unmarshall(response.Items[0]) as { id: string };
  return data;
}

export async function batchGetUserInfo({
  emails,
  dynamoClient,
  logger,
}: {
  emails: string[];
  dynamoClient: DynamoDBClient;
  logger: ValidLoggers;
}) {
  const results: Record<
    string,
    {
      firstName?: string;
      lastName?: string;
    }
  > = {};

  // DynamoDB BatchGetItem has a limit of 100 items per request
  const BATCH_SIZE = 100;

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);

    try {
      await retryDynamoTransactionWithBackoff(
        async () => {
          const response = await dynamoClient.send(
            new BatchGetItemCommand({
              RequestItems: {
                [genericConfig.UserInfoTable]: {
                  Keys: batch.map((email) => ({
                    id: { S: email },
                  })),
                  ProjectionExpression: "id, firstName, lastName",
                },
              },
            }),
          );

          // Process responses
          const items = response.Responses?.[genericConfig.UserInfoTable] || [];
          for (const item of items) {
            const email = item.id?.S;
            if (email) {
              results[email] = {
                firstName: item.firstName?.S,
                lastName: item.lastName?.S,
              };
            }
          }

          // If there are unprocessed keys, throw to trigger retry
          if (
            response.UnprocessedKeys &&
            Object.keys(response.UnprocessedKeys).length > 0
          ) {
            const error = new Error(
              "UnprocessedKeys present - triggering retry",
            );
            error.name = "TransactionCanceledException";
            throw error;
          }
        },
        logger,
        `batchGetUserInfo (batch ${i / BATCH_SIZE + 1})`,
      );
    } catch (error) {
      logger.warn(
        `Failed to fetch batch ${i / BATCH_SIZE + 1} after retries, returning partial results`,
        { error },
      );
    }
  }

  return results;
}
