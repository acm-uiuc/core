import {
  UpdateItemCommand,
  type DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { ValidLoggers } from "api/types.js";
import { genericConfig } from "common/config.js";
import { BaseError, InternalServerError } from "common/errors/index.js";

export interface EnsurePaidMemberListmonkEnrollmentInputs {
  dynamoClient: DynamoDBClient;
  netId: string;
  firstName: string;
  lastName: string;
  logger: ValidLoggers;
  apiUsername: string;
  apiToken: string;
  listmonkBaseUrl: string;
  paidMemberLists: number[];
}

export interface HandleListmonkEnrollmentInputs {
  listmonkBaseUrl: string;
  lists: number[];
  firstName: string;
  lastName: string;
  email: string;
  logger: ValidLoggers;
  apiUsername: string;
  apiToken: string;
}

export async function handleListmonkEnrollment({
  listmonkBaseUrl,
  lists,
  firstName,
  lastName,
  email,
  logger,
  apiUsername,
  apiToken,
}: HandleListmonkEnrollmentInputs) {
  const credentials = Buffer.from(`${apiUsername}:${apiToken}`).toString(
    "base64",
  );
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Basic ${credentials}`,
  };
  const response = await fetch(`${listmonkBaseUrl}/api/subscribers`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email,
      name: `${firstName} ${lastName}`.trim(),
      status: "enabled",
      lists,
      preconfirm_subscriptions: true,
    }),
  });
  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(`Listmonk enrollment failed: ${errorBody}`);
    throw new InternalServerError({
      message: "Failed to enroll user in listmonk lists",
    });
  }
  return (await response.json()) as {
    data: { id: number; createdAt: string; updatedAt: string; uuid: string };
  };
}
export async function recordUserListmonkEnrollment(
  netId: string,
  isEnrolled: boolean,
  dynamoClient: DynamoDBClient,
): Promise<{ updated: boolean }> {
  const result = await dynamoClient.send(
    new UpdateItemCommand({
      TableName: genericConfig.UserInfoTable,
      Key: marshall({
        id: `${netId}@illinois.edu`,
      }),
      UpdateExpression: "SET isListmonkEnrolled = :enrolled",
      ConditionExpression: "attribute_exists(id)",
      ExpressionAttributeValues: marshall({
        ":enrolled": isEnrolled,
      }),
      ReturnValues: "UPDATED_OLD",
    }),
  );

  const oldValue = result.Attributes
    ? unmarshall(result.Attributes).isListmonkEnrolled
    : undefined;

  return { updated: oldValue !== isEnrolled };
}

export async function ensurePaidMemberListmonkEnrollment({
  dynamoClient,
  netId,
  firstName,
  lastName,
  logger,
  apiToken,
  apiUsername,
  listmonkBaseUrl,
  paidMemberLists,
}: EnsurePaidMemberListmonkEnrollmentInputs) {
  const { updated: needsEnrollment } = await recordUserListmonkEnrollment(
    netId,
    true,
    dynamoClient,
  );
  if (!needsEnrollment) {
    logger.warn(`User ${netId} is already enrolled in listmonk lists.`);
    return;
  }
  try {
    await handleListmonkEnrollment({
      apiToken,
      apiUsername,
      listmonkBaseUrl,
      firstName,
      lastName,
      email: `${netId}@illinois.edu`,
      logger,
      lists: paidMemberLists,
    });
  } catch (e) {
    await recordUserListmonkEnrollment(netId, false, dynamoClient);
    if (e instanceof BaseError) {
      throw e;
    }
    logger.error(e, "An error occurred setting Listmonk enrollment.");
    throw new InternalServerError({
      message: "An error occurred setting Listmonk enrollment.",
    });
  }
}
