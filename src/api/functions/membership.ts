import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { genericConfig } from "common/config.js";
import {
  addToTenant,
  isUserInGroup,
  modifyGroup,
  patchUserProfile,
  resolveEmailToOid,
} from "./entraId.js";
import { EntraGroupError } from "common/errors/index.js";
import { EntraGroupActions } from "common/types/iam.js";
import { pollUntilNoError } from "./general.js";
import Redis from "ioredis";
import { getKey } from "./redisCache.js";
import { FastifyBaseLogger } from "fastify";

export const MEMBER_CACHE_SECONDS = 43200; // 12 hours

export async function checkExternalMembership(
  netId: string,
  list: string,
  dynamoClient: DynamoDBClient,
): Promise<boolean> {
  const { Items } = await dynamoClient.send(
    new QueryCommand({
      TableName: genericConfig.ExternalMembershipTableName,
      KeyConditionExpression: "#pk = :pk and #sk = :sk",
      ExpressionAttributeNames: {
        "#pk": "netId",
        "#sk": "memberList",
      },
      ExpressionAttributeValues: marshall({
        ":pk": netId,
        ":sk": list,
      }),
    }),
  );
  if (!Items || Items.length === 0) {
    return false;
  }
  return true;
}

export async function checkPaidMembershipFromRedis(
  netId: string,
  redisClient: Redis.default,
  logger: FastifyBaseLogger,
) {
  const cacheKey = `membership:${netId}:acmpaid`;
  const result = await getKey<{ isMember: boolean }>({
    redisClient,
    key: cacheKey,
    logger,
  });
  if (!result) {
    return null;
  }
  return result.isMember;
}

export async function checkPaidMembershipFromTable(
  netId: string,
  dynamoClient: DynamoDBClient,
): Promise<boolean> {
  const { Items } = await dynamoClient.send(
    new QueryCommand({
      TableName: genericConfig.MembershipTableName,
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: {
        "#pk": "email",
      },
      ExpressionAttributeValues: marshall({
        ":pk": `${netId}@illinois.edu`,
      }),
    }),
  );
  if (!Items || Items.length === 0) {
    return false;
  }
  return true;
}

export async function checkPaidMembershipFromEntra(
  netId: string,
  entraToken: string,
  paidMemberGroup: string,
): Promise<boolean> {
  try {
    return await isUserInGroup(
      entraToken,
      `${netId}@illinois.edu`,
      paidMemberGroup,
    );
  } catch (e) {
    if (e instanceof EntraGroupError) {
      return false;
    }
    throw e;
  }
}

export async function setPaidMembershipInTable(
  netId: string,
  dynamoClient: DynamoDBClient,
  actor: string = "core-api-queried",
): Promise<{ updated: boolean }> {
  const obj = {
    email: `${netId}@illinois.edu`,
    inserted_at: new Date().toISOString(),
    inserted_by: actor,
  };

  try {
    await dynamoClient.send(
      new PutItemCommand({
        TableName: genericConfig.MembershipTableName,
        Item: marshall(obj),
        ConditionExpression: "attribute_not_exists(email)",
      }),
    );
    return { updated: true };
  } catch (error: unknown) {
    if (error instanceof ConditionalCheckFailedException) {
      return { updated: false };
    }
    throw error;
  }
}

type SetPaidMembershipInput = {
  netId: string;
  firstName: string;
  lastName: string;
  dynamoClient: DynamoDBClient;
  entraToken: string;
  paidMemberGroup: string;
};

type SetPaidMembershipOutput = {
  updated: boolean;
};

export async function setPaidMembership({
  netId,
  dynamoClient,
  entraToken,
  paidMemberGroup,
  firstName,
  lastName,
}: SetPaidMembershipInput): Promise<SetPaidMembershipOutput> {
  const dynamoResult = await setPaidMembershipInTable(
    netId,
    dynamoClient,
    "core-api-provisioned",
  );
  if (!dynamoResult.updated) {
    const inEntra = await checkPaidMembershipFromEntra(
      netId,
      entraToken,
      paidMemberGroup,
    );
    if (inEntra) {
      return { updated: false };
    }
  }
  const email = `${netId}@illinois.edu`;
  await addToTenant(entraToken, email);
  // Poll every 4 seconds for up to 30 seconds to see if the email was added to the tenant.
  // If this still errors, SQS will retry, and if that still errors we'll find it in the DLQ
  await pollUntilNoError(
    () => resolveEmailToOid(entraToken, email),
    30000,
    4000,
  );
  const oid = await resolveEmailToOid(entraToken, email);
  await modifyGroup(
    entraToken,
    email,
    paidMemberGroup,
    EntraGroupActions.ADD,
    dynamoClient,
  );
  await patchUserProfile(entraToken, email, oid, {
    displayName: `${firstName} ${lastName}`,
    givenName: firstName,
    surname: lastName,
  });

  return { updated: true };
}
