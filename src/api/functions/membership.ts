import {
  BatchWriteItemCommand,
  ConditionalCheckFailedException,
  DynamoDBClient,
  QueryCommand,
  UpdateItemCommand,
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
import { createAuditLogEntry } from "./auditLog.js";
import { Modules } from "common/modules.js";
import { ValidLoggers } from "api/types.js";

export const MEMBER_CACHE_SECONDS = 43200; // 12 hours

export function getMembershipCacheKey(netId: string, list: string) {
  return `membership:${netId}:${list}`;
}

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
  logger: ValidLoggers;
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
      key: getMembershipCacheKey(x, listId),
      data: JSON.stringify({ isMember: false }),
      expiresIn: MEMBER_CACHE_SECONDS,
      logger,
    }),
  );
  const addCacheInvalidation = add.map((x) =>
    setKey({
      redisClient,
      key: getMembershipCacheKey(x, listId),
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

export async function checkListMembershipFromRedis(
  netId: string,
  list: string,
  redisClient: Redis.default,
  logger: FastifyBaseLogger,
) {
  const cacheKey = getMembershipCacheKey(netId, list);
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

interface CheckExternalMembershipInputs {
  netId: string;
  list: string;
  dynamoClient: DynamoDBClient;
  redisClient: Redis.Redis;
  logger: ValidLoggers;
}

export async function checkExternalMembership({
  netId,
  list,
  dynamoClient,
  redisClient,
  logger,
}: CheckExternalMembershipInputs) {
  const cacheKey = getMembershipCacheKey(netId, list);
  // First check redis
  const inCache = await checkListMembershipFromRedis(
    netId,
    list,
    redisClient,
    logger,
  );
  if (inCache === true) {
    return inCache;
  }
  logger.debug({ netId }, "Checking external membership in DynamoDB Table.");
  const isMemberInTable = await checkExternalMembershipFromTable(
    netId,
    list,
    dynamoClient,
  );
  logger.debug({ netId, isMemberInTable }, "Membership check finished.");
  // Populate cache
  try {
    await redisClient.set(
      cacheKey,
      JSON.stringify({ isMember: isMemberInTable }),
      "EX",
      MEMBER_CACHE_SECONDS,
    );
  } catch (error) {
    logger.error({ err: error, netId }, "Failed to update membership cache");
  }
  return isMemberInTable;
}

export async function checkExternalMembershipFromTable(
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

export async function checkPaidMembershipFromTable(
  netId: string,
  dynamoClient: DynamoDBClient,
): Promise<boolean> {
  const { Items } = await dynamoClient.send(
    new QueryCommand({
      TableName: genericConfig.UserInfoTable,
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: {
        "#pk": "id",
      },
      ExpressionAttributeValues: marshall({
        ":pk": `${netId}@illinois.edu`,
      }),
    }),
  );
  if (!Items || Items.length === 0) {
    return false;
  }
  const item = unmarshall(Items[0]);
  if (!item.isPaidMember) {
    return false;
  }
  return true;
}
interface CheckMemberOfAnyListInputs {
  netId: string;
  lists: string[];
  dynamoClient: DynamoDBClient;
  redisClient: Redis.Redis;
  logger: ValidLoggers;
}
export async function checkMemberOfAnyList({
  netId,
  lists,
  dynamoClient,
  redisClient,
  logger,
}: CheckMemberOfAnyListInputs) {
  const checks = lists.map((list) => {
    if (list === "acmpaid") {
      return checkPaidMembership({
        netId,
        dynamoClient,
        redisClient,
        logger,
      });
    }
    return checkExternalMembership({
      netId,
      list,
      dynamoClient,
      redisClient,
      logger,
    });
  });
  const results = await Promise.allSettled(checks);
  for (const result of results) {
    if (result.status === "rejected") {
      logger.warn({ err: result.reason }, "Membership check failed");
    }
  }
  // Return true if any check succeeded and returned true
  return results.some(
    (result) => result.status === "fulfilled" && result.value === true,
  );
}

/**
 * This check is slow!! Don't use it unless you have a really good reason.
 * Membership data is replicated to DynamoDB on provision (and EntraID second) so just read from the user-info table. */
async function checkPaidMembershipFromEntra(
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
  const email = `${netId}@illinois.edu`;
  try {
    await dynamoClient.send(
      new UpdateItemCommand({
        TableName: genericConfig.UserInfoTable,
        Key: {
          id: {
            S: email,
          },
        },
        UpdateExpression: `SET #netId = :netId, #updatedAt = :updatedAt, #isPaidMember = :isPaidMember`,
        ConditionExpression: `#isPaidMember <> :isPaidMember`,
        ExpressionAttributeNames: {
          "#netId": "netId",
          "#updatedAt": "updatedAt",
          "#isPaidMember": "isPaidMember",
        },
        ExpressionAttributeValues: {
          ":netId": { S: netId },
          ":isPaidMember": { BOOL: true },
          ":updatedAt": { S: new Date().toISOString() },
        },
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
    userPrincipalName: `${netId}@acm.illinois.edu`,
  });

  return { updated: true };
}

export async function checkPaidMembership({
  netId,
  redisClient,
  dynamoClient,
  logger,
}: {
  netId: string;
  redisClient: Redis.Redis;
  dynamoClient: DynamoDBClient;
  logger: FastifyBaseLogger;
}): Promise<boolean> {
  // 1. Check Redis cache
  const isMemberInCache = await checkListMembershipFromRedis(
    netId,
    "acmpaid",
    redisClient,
    logger,
  );

  if (isMemberInCache === true) {
    return true;
  }

  // 2. If cache missed or was negative, query DynamoDB
  const isMemberInDB = await checkPaidMembershipFromTable(netId, dynamoClient);

  // 3. If membership is confirmed, update the cache
  if (isMemberInDB) {
    const cacheKey = getMembershipCacheKey(netId, "acmpaid");
    try {
      await redisClient.set(
        cacheKey,
        JSON.stringify({ isMember: true }),
        "EX",
        MEMBER_CACHE_SECONDS,
      );
    } catch (error) {
      logger.error({ err: error, netId }, "Failed to update membership cache");
    }
  }

  return isMemberInDB;
}
