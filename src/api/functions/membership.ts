import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { genericConfig } from "common/config.js";
import { FastifyBaseLogger } from "fastify";
import { isUserInGroup, modifyGroup } from "./entraId.js";
import { EntraGroupError } from "common/errors/index.js";
import { EntraGroupActions } from "common/types/iam.js";

export async function checkPaidMembership(
  endpoint: string,
  log: FastifyBaseLogger,
  netId: string,
) {
  const membershipApiPayload = (await (
    await fetch(`${endpoint}?netId=${netId}`)
  ).json()) as { netId: string; isPaidMember: boolean };
  log.trace(`Got Membership API Payload for ${netId}: ${membershipApiPayload}`);
  try {
    return membershipApiPayload["isPaidMember"];
  } catch (e: unknown) {
    if (!(e instanceof Error)) {
      log.error(
        "Failed to get response from membership API (unknown error type.)",
      );
      throw e;
    }
    log.error(`Failed to get response from membership API: ${e.toString()}`);
    throw e;
  }
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
  if (!Items || Items.length == 0) {
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
): Promise<{ updated: boolean }> {
  const obj = {
    email: `${netId}@illinois.edu`,
    inserted_at: new Date().toISOString(),
    inserted_by: "membership-api-queried",
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
}: SetPaidMembershipInput): Promise<SetPaidMembershipOutput> {
  const dynamoResult = await setPaidMembershipInTable(netId, dynamoClient);
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
  await modifyGroup(
    entraToken,
    `${netId}@illinois.edu`,
    paidMemberGroup,
    EntraGroupActions.ADD,
  );

  return { updated: true };
}
