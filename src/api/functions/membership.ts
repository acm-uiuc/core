import {
  BatchWriteItemCommand,
  ConditionalCheckFailedException,
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { genericConfig } from "common/config.js";
import {
  addToTenant,
  isUserInGroup,
  modifyGroup,
  patchUserProfile,
  resolveEmailToOid,
} from "./entraId.js";
import { EntraGroupError, ValidationError } from "common/errors/index.js";
import { EntraGroupActions } from "common/types/iam.js";
import { pollUntilNoError } from "./general.js";
import Redis from "ioredis";
import { getKey, setKey } from "./redisCache.js";
import { FastifyBaseLogger } from "fastify";
import type pino from "pino";
import { createAuditLogEntry } from "./auditLog.js";
import { Modules } from "common/modules.js";

export const MEMBER_CACHE_SECONDS = 43200; // 12 hours

export async function patchExternalMemberList({
  listId: oldListId,
  add: oldAdd,
  remove: oldRemove,
  clients: { dynamoClient, redisClient },
  logger,
  auditLogData: { actor, requestId },
}: {
  listId: string;
  add: string[];
  remove: string[];
  clients: { dynamoClient: DynamoDBClient; redisClient: Redis.default };
  logger: pino.Logger | FastifyBaseLogger;
  auditLogData: { actor: string; requestId: string };
}) {
  const listId = oldListId.toLowerCase();
  const add = oldAdd.map((x) => x.toLowerCase());
  const remove = oldRemove.map((x) => x.toLowerCase());
  if (add.length === 0 && remove.length === 0) {
    return;
  }
  const addSet = new Set(add);

  const conflictingNetId = remove.find((netId) => addSet.has(netId));

  if (conflictingNetId) {
    throw new ValidationError({
      message: `The netId '${conflictingNetId}' cannot be in both the 'add' and 'remove' lists simultaneously.`,
    });
  }
  const writeRequests = [];
  // Create PutRequest objects for each member to be added.
  for (const netId of add) {
    writeRequests.push({
      PutRequest: {
        Item: {
          memberList: { S: listId },
          netId: { S: netId },
        },
      },
    });
  }
  // Create DeleteRequest objects for each member to be removed.
  for (const netId of remove) {
    writeRequests.push({
      DeleteRequest: {
        Key: {
          memberList: { S: listId },
          netId: { S: netId },
        },
      },
    });
  }
  const BATCH_SIZE = 25;
  const batchPromises = [];
  for (let i = 0; i < writeRequests.length; i += BATCH_SIZE) {
    const batch = writeRequests.slice(i, i + BATCH_SIZE);
    const command = new BatchWriteItemCommand({
      RequestItems: {
        [genericConfig.ExternalMembershipTableName]: batch,
      },
    });
    batchPromises.push(dynamoClient.send(command));
  }
  const removeCacheInvalidation = remove.map((x) =>
    setKey({
      redisClient,
      key: `membership:${x}:${listId}`,
      data: JSON.stringify({ isMember: false }),
      expiresIn: MEMBER_CACHE_SECONDS,
      logger,
    }),
  );
  const addCacheInvalidation = add.map((x) =>
    setKey({
      redisClient,
      key: `membership:${x}:${listId}`,
      data: JSON.stringify({ isMember: true }),
      expiresIn: MEMBER_CACHE_SECONDS,
      logger,
    }),
  );
  const auditLogPromises = [];
  if (add.length > 0) {
    auditLogPromises.push(
      createAuditLogEntry({
        dynamoClient,
        entry: {
          module: Modules.EXTERNAL_MEMBERSHIP,
          actor,
          requestId,
          message: `Added ${add.length} member(s) to target list.`,
          target: listId,
        },
      }),
    );
  }
  if (remove.length > 0) {
    auditLogPromises.push(
      createAuditLogEntry({
        dynamoClient,
        entry: {
          module: Modules.EXTERNAL_MEMBERSHIP,
          actor,
          requestId,
          message: `Removed ${remove.length} member(s) from target list.`,
          target: listId,
        },
      }),
    );
  }
  await Promise.all([
    ...removeCacheInvalidation,
    ...addCacheInvalidation,
    ...batchPromises,
  ]);
  await Promise.all(auditLogPromises);
}
export async function getExternalMemberList(
  list: string,
  dynamoClient: DynamoDBClient,
): Promise<string[]> {
  const { Items } = await dynamoClient.send(
    new QueryCommand({
      TableName: genericConfig.ExternalMembershipTableName,
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: {
        "#pk": "memberList",
      },
      ExpressionAttributeValues: marshall({
        ":pk": list,
      }),
    }),
  );
  if (!Items || Items.length === 0) {
    return [];
  }
  return Items.map((x) => unmarshall(x))
    .filter((x) => !!x)
    .map((x) => x.netId)
    .sort();
}

export async function checkExternalMembership(
  netId: string,
  list: string,
  dynamoClient: DynamoDBClient,
): Promise<boolean> {
  const { Items } = await dynamoClient.send(
    new QueryCommand({
      TableName: genericConfig.ExternalMembershipTableName,
      KeyConditionExpression: "#pk = :pk and #sk = :sk",
      IndexName: "invertedIndex",
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
