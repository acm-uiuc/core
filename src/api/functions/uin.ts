import {
  BatchGetItemCommand,
  DynamoDBClient,
  QueryCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { ValidLoggers } from "api/types.js";
import { retryDynamoTransactionWithBackoff } from "api/utils.js";
import { Algorithm, hash, Version } from "@node-rs/argon2";
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
import * as z from "zod/v4";
import { UIN_RETENTION_DAYS } from "common/constants.js";

export type GetUserUinInputs = {
  uiucAccessToken: string;
};

export const graphApiExpectedResponseSchema = z.object({
  userPrincipalName: z
    .string()
    .min(1)
    .refine((val) => val.endsWith("@illinois.edu"), {
      message: "userPrincipalName must have domain @illinois.edu",
    }),
  givenName: z.string().min(1),
  surname: z.string().min(1),
  mail: z.string().min(1),
});

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

    const data = await graphApiExpectedResponseSchema.parseAsync(
      await response.json(),
    );
    const netId = data.userPrincipalName.replace("@illinois.edu", "");
    logger.info(`Authenticated UIUC tenant user ${data.userPrincipalName}.`);
    return { ...data, netId };
  } catch (error) {
    if (error instanceof BaseError) {
      throw error;
    } else if (error instanceof z.ZodError) {
      logger.error(error, "Failed to parse Graph API response");
      throw new UnauthenticatedError({
        message: "Failed to parse user identity.",
      });
    } else {
      logger.error(error);
      throw new InternalServerError({
        message:
          "An unexpected error occurred during access token verification.",
      });
    }
  }
};

export async function getUserUin({
  uiucAccessToken,
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

    return data[genericConfig.UinExtendedAttributeName];
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

type SaveUserUin = GetUserUinInputs & {
  dynamoClient: DynamoDBClient;
  netId: string;
};

export async function saveUserUin({
  uiucAccessToken,
  dynamoClient,
  netId,
}: SaveUserUin) {
  const uin = await getUserUin({ uiucAccessToken });
  const expiresAt = Math.floor(Date.now() / 1000) + UIN_RETENTION_DAYS * 86400;
  await dynamoClient.send(
    new UpdateItemCommand({
      TableName: genericConfig.UserInfoTable,
      Key: {
        id: { S: `UIN#${netId}@illinois.edu` },
      },
      UpdateExpression:
        "SET #uin = :uin, #netId = :netId, #updatedAt = :updatedAt, #expiresAt = :expiresAt",
      ExpressionAttributeNames: {
        "#uin": "uin",
        "#netId": "netId",
        "#updatedAt": "updatedAt",
        "#expiresAt": "expiresAt",
      },
      ExpressionAttributeValues: {
        ":uin": { S: uin },
        ":netId": { S: netId },
        ":updatedAt": { S: new Date().toISOString() },
        ":expiresAt": { N: expiresAt.toString() },
      },
    }),
  );
}

export async function getUserIdByUin({
  dynamoClient,
  uin,
}: {
  dynamoClient: DynamoDBClient;
  uin: string;
}): Promise<{ id: string }> {
  const queryCommand = new QueryCommand({
    TableName: genericConfig.UserInfoTable,
    IndexName: "UinIndex",
    KeyConditionExpression: "uin = :uin",
    ExpressionAttributeValues: {
      ":uin": { S: uin },
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
  const cleanedData = { id: data.id.replace("UIN#", "") };
  return cleanedData;
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
