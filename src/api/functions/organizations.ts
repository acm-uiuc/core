import { AllOrganizationNameList, OrganizationName } from "@acm-uiuc/js-shared";
import {
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
  type DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { genericConfig } from "common/config.js";
import { BaseError, DatabaseFetchError } from "common/errors/index.js";
import { OrgRole, orgRoles } from "common/roles.js";
import {
  enforcedOrgLeadEntry,
  getOrganizationInfoResponse,
} from "common/types/organizations.js";
import { AvailableSQSFunctions } from "common/types/sqsMessage.js";
import { getAllUserEmails } from "common/utils.js";
import { type FastifyBaseLogger } from "fastify";
import pino from "pino";
import z from "zod";
import { modifyGroup } from "./entraId.js";
import { EntraGroupActions } from "common/types/iam.js";
import { buildAuditLogTransactPut } from "./auditLog.js";
import { Modules } from "common/modules.js";
import { retryDynamoTransactionWithBackoff } from "api/utils.js";
import { Redis, ValidLoggers } from "api/types.js";
import { createLock, IoredisAdapter, type SimpleLock } from "redlock-universal";

export interface GetOrgInfoInputs {
  id: string;
  dynamoClient: DynamoDBClient;
  logger: ValidLoggers;
}

export interface GetUserOrgRolesInputs {
  username: string;
  dynamoClient: DynamoDBClient;
  logger: ValidLoggers;
}

export type SQSMessage = Record<any, any>;

export async function getOrgInfo({
  id,
  dynamoClient,
  logger,
}: GetOrgInfoInputs) {
  const query = new QueryCommand({
    TableName: genericConfig.SigInfoTableName,
    KeyConditionExpression: `primaryKey = :definitionId`,
    ExpressionAttributeValues: {
      ":definitionId": { S: `DEFINE#${id}` },
    },
    ConsistentRead: true,
  });
  let response = { leads: [] } as {
    leads: { name: string; username: string; title: string | undefined }[];
  };
  try {
    const responseMarshall = await dynamoClient.send(query);
    if (
      !responseMarshall ||
      !responseMarshall.Items ||
      responseMarshall.Items.length === 0
    ) {
      logger.debug(
        `Could not find SIG information for ${id}, returning default.`,
      );
      return { id };
    }
    const temp = unmarshall(responseMarshall.Items[0]);
    temp.id = temp.primaryKey.replace("DEFINE#", "");
    delete temp.primaryKey;
    response = { ...temp, ...response };
  } catch (e) {
    if (e instanceof BaseError) {
      throw e;
    }
    logger.error(e);
    throw new DatabaseFetchError({
      message: "Failed to get org metadata.",
    });
  }

  const leadsQuery = new QueryCommand({
    TableName: genericConfig.SigInfoTableName,
    KeyConditionExpression: "primaryKey = :leadName",
    ExpressionAttributeValues: {
      ":leadName": { S: `LEAD#${id}` },
    },
    ConsistentRead: true,
  });
  try {
    const responseMarshall = await dynamoClient.send(leadsQuery);
    if (responseMarshall.Items) {
      const unmarshalledLeads = responseMarshall.Items.map((x) => unmarshall(x))
        .filter((x) => x.username)
        .map(
          (x) =>
            ({
              name: x.name,
              username: x.username,
              title: x.title,
            }) as { name: string; username: string; title: string | undefined },
        );
      response = { ...response, leads: unmarshalledLeads };
    }
  } catch (e) {
    if (e instanceof BaseError) {
      throw e;
    }
    logger.error(e);
    throw new DatabaseFetchError({
      message: "Failed to get org leads.",
    });
  }
  return response as z.infer<typeof getOrganizationInfoResponse>;
}

export async function getUserOrgRoles({
  username,
  dynamoClient,
  logger,
}: GetUserOrgRolesInputs) {
  const query = new QueryCommand({
    TableName: genericConfig.SigInfoTableName,
    IndexName: "UsernameIndex",
    KeyConditionExpression: `username = :username`,
    ExpressionAttributeValues: {
      ":username": { S: username },
    },
  });
  try {
    const response = await dynamoClient.send(query);
    if (!response || !response.Items) {
      return [];
    }
    const unmarshalled = response.Items.map((x) => unmarshall(x)).map(
      (x) =>
        ({ username: x.username, rawRole: x.primaryKey }) as {
          username: string;
          rawRole: string;
        },
    );
    const cleanedRoles = [];
    for (const item of unmarshalled) {
      const splits = item.rawRole.split("#");
      if (splits.length !== 2) {
        logger.warn(`Invalid PK in role definition: ${JSON.stringify(item)}`);
        continue;
      }
      const [role, org] = splits;
      if (!orgRoles.includes(role as OrgRole)) {
        logger.warn(`Invalid role in role definition: ${JSON.stringify(item)}`);
        continue;
      }
      if (!AllOrganizationNameList.includes(org as OrganizationName)) {
        logger.warn(`Invalid org in role definition: ${JSON.stringify(item)}`);
        continue;
      }
      cleanedRoles.push({
        org,
        role,
      } as { org: OrganizationName; role: OrgRole });
    }
    return cleanedRoles;
  } catch (e) {
    if (e instanceof BaseError) {
      throw e;
    }
    logger.error(e);
    throw new DatabaseFetchError({
      message: "Could not get roles for user.",
    });
  }
}

export const addLead = async ({
  user,
  orgId,
  actorUsername,
  reqId,
  entraGroupId,
  entraIdToken,
  dynamoClient,
  logger,
  officersEmail,
  redisClient,
  shouldSkipEnhancedActions,
}: {
  user: z.infer<typeof enforcedOrgLeadEntry>;
  orgId: string;
  actorUsername: string;
  reqId: string;
  entraGroupId?: string;
  entraIdToken: string;
  dynamoClient: DynamoDBClient;
  logger: FastifyBaseLogger;
  officersEmail: string;
  redisClient: Redis;
  shouldSkipEnhancedActions: boolean;
}): Promise<SQSMessage | null> => {
  const { username } = user;

  const lock = createLock({
    adapter: new IoredisAdapter(redisClient),
    key: `user:${username}`,
    retryAttempts: 5,
    retryDelay: 300,
  }) as SimpleLock;

  return await lock.using(async () => {
    let entraAddSucceeded = false;

    try {
      // Step 1: Add to Entra ID first (if applicable)
      if (entraGroupId && !shouldSkipEnhancedActions) {
        logger.info(
          `Adding ${username} to Entra group for ${orgId} (Group ID: ${entraGroupId}).`,
        );

        await modifyGroup(
          entraIdToken,
          username,
          entraGroupId,
          EntraGroupActions.ADD,
          dynamoClient,
        );

        entraAddSucceeded = true;
        logger.info(
          `Successfully added ${username} to Entra group for ${orgId}.`,
        );
      }

      // Step 2: Add to DynamoDB
      const addTransaction = new TransactWriteItemsCommand({
        TransactItems: [
          buildAuditLogTransactPut({
            entry: {
              module: Modules.ORG_INFO,
              actor: actorUsername,
              target: username,
              message: `Added target as a lead of ${orgId}.`,
            },
          })!,
          {
            Put: {
              TableName: genericConfig.SigInfoTableName,
              Item: marshall(
                {
                  ...user,
                  primaryKey: `LEAD#${orgId}`,
                  entryId: username,
                  updatedAt: new Date().toISOString(),
                },
                { removeUndefinedValues: true },
              ),
              ConditionExpression:
                "attribute_not_exists(primaryKey) AND attribute_not_exists(entryId)",
            },
          },
        ],
      });

      try {
        await retryDynamoTransactionWithBackoff(
          async () => await dynamoClient.send(addTransaction),
          logger,
          `Add lead ${username} to ${orgId}`,
        );
      } catch (e: any) {
        if (
          e.name === "TransactionCanceledException" &&
          e.message.includes("ConditionalCheckFailed")
        ) {
          logger.info(
            `User ${username} is already a lead for ${orgId}. Rolling back Entra changes if needed.`,
          );

          // Rollback Entra ID if it was added
          if (entraAddSucceeded && entraGroupId) {
            logger.warn(
              `Rolling back Entra group addition for ${username} in ${orgId}.`,
            );
            try {
              await modifyGroup(
                entraIdToken,
                username,
                entraGroupId,
                EntraGroupActions.REMOVE,
                dynamoClient,
              );
              logger.info(
                `Successfully rolled back Entra group addition for ${username}.`,
              );
            } catch (rollbackError) {
              logger.error(
                `CRITICAL: Failed to rollback Entra group addition for ${username} in ${orgId}. Manual intervention required.`,
                rollbackError,
              );
            }
          }

          return null;
        }
        throw e; // Re-throw for outer catch block
      }

      logger.info(
        `Successfully added ${username} as lead for ${orgId} in DynamoDB.`,
      );

      // Step 3: Send notification email
      return {
        function: AvailableSQSFunctions.EmailNotifications,
        metadata: { initiator: actorUsername, reqId },
        payload: {
          to: getAllUserEmails(username),
          cc: [officersEmail],
          subject: `${user.nonVotingMember ? "Non-voting lead" : "Lead"} added for ${orgId}`,
          content: `Hello,\n\nWe're letting you know that ${username} has been added as a ${user.nonVotingMember ? "non-voting" : ""} lead for ${orgId} by ${actorUsername}.${shouldSkipEnhancedActions ? "\nLeads for this org are not updated automatically in external systems (such as Entra ID). Please contact the appropriate administrators to ensure these updates are made.\n" : "\n"}Changes may take up to 2 hours to reflect in all systems.`,
        },
      };
    } catch (error) {
      // Rollback Entra ID if DynamoDB operation failed
      if (entraAddSucceeded && entraGroupId) {
        logger.error(
          `DynamoDB operation failed for ${username} in ${orgId}. Rolling back Entra group addition.`,
        );
        try {
          await modifyGroup(
            entraIdToken,
            username,
            entraGroupId,
            EntraGroupActions.REMOVE,
            dynamoClient,
          );
          logger.info(
            `Successfully rolled back Entra group addition for ${username}.`,
          );
        } catch (rollbackError) {
          logger.error(
            `CRITICAL: Failed to rollback Entra group addition for ${username} in ${orgId}. Manual intervention required.`,
            rollbackError,
          );
        }
      }

      // Re-throw the original error
      throw error;
    }
  });
};

export const removeLead = async ({
  username,
  orgId,
  actorUsername,
  reqId,
  entraGroupId,
  entraIdToken,
  dynamoClient,
  logger,
  officersEmail,
  redisClient,
  shouldSkipEnhancedActions,
}: {
  username: string;
  orgId: string;
  actorUsername: string;
  reqId: string;
  entraGroupId?: string;
  entraIdToken: string;
  dynamoClient: DynamoDBClient;
  logger: FastifyBaseLogger;
  officersEmail: string;
  redisClient: Redis;
  shouldSkipEnhancedActions: boolean;
}): Promise<SQSMessage | null> => {
  const lock = createLock({
    adapter: new IoredisAdapter(redisClient),
    key: `user:${username}`,
    retryAttempts: 5,
    retryDelay: 300,
  }) as SimpleLock;

  return await lock.using(async () => {
    let entraRemoveSucceeded = false;

    try {
      // Step 1: Remove from Entra ID first (if applicable)
      if (entraGroupId && !shouldSkipEnhancedActions) {
        logger.info(
          `Removing ${username} from Entra group for ${orgId} (Group ID: ${entraGroupId}).`,
        );

        await modifyGroup(
          entraIdToken,
          username,
          entraGroupId,
          EntraGroupActions.REMOVE,
          dynamoClient,
        );

        entraRemoveSucceeded = true;
        logger.info(
          `Successfully removed ${username} from Entra group for ${orgId}.`,
        );
      }

      // Step 2: Remove from DynamoDB
      const removeTransaction = new TransactWriteItemsCommand({
        TransactItems: [
          buildAuditLogTransactPut({
            entry: {
              module: Modules.ORG_INFO,
              actor: actorUsername,
              target: username,
              message: `Removed target from lead of ${orgId}.`,
            },
          })!,
          {
            Delete: {
              TableName: genericConfig.SigInfoTableName,
              Key: marshall({
                primaryKey: `LEAD#${orgId}`,
                entryId: username,
              }),
              ConditionExpression:
                "attribute_exists(primaryKey) AND attribute_exists(entryId)",
            },
          },
        ],
      });

      try {
        await retryDynamoTransactionWithBackoff(
          async () => await dynamoClient.send(removeTransaction),
          logger,
          `Remove lead ${username} from ${orgId}`,
        );
      } catch (e: any) {
        if (
          e.name === "TransactionCanceledException" &&
          e.message.includes("ConditionalCheckFailed")
        ) {
          logger.info(
            `User ${username} was not a lead for ${orgId}. Rolling back Entra changes if needed.`,
          );

          // Rollback Entra ID if it was removed
          if (entraRemoveSucceeded && entraGroupId) {
            logger.warn(
              `Rolling back Entra group removal for ${username} in ${orgId}.`,
            );
            try {
              await modifyGroup(
                entraIdToken,
                username,
                entraGroupId,
                EntraGroupActions.ADD,
                dynamoClient,
              );
              logger.info(
                `Successfully rolled back Entra group removal for ${username}.`,
              );
            } catch (rollbackError) {
              logger.error(
                `CRITICAL: Failed to rollback Entra group removal for ${username} in ${orgId}. Manual intervention required.`,
                rollbackError,
              );
            }
          }

          return null;
        }
        throw e; // Re-throw for outer catch block
      }

      logger.info(
        `Successfully removed ${username} as lead for ${orgId} in DynamoDB.`,
      );

      // Step 3: Send notification email
      return {
        function: AvailableSQSFunctions.EmailNotifications,
        metadata: { initiator: actorUsername, reqId },
        payload: {
          to: getAllUserEmails(username),
          cc: [officersEmail],
          subject: `Lead removed for ${orgId}`,
          content: `Hello,\n\nWe're letting you know that ${username} has been removed as a lead for ${orgId} by ${actorUsername}.${shouldSkipEnhancedActions ? "\nLeads for this org are not updated automatically in external systems (such as Entra ID). Please contact the appropriate administrators to make sure these updates are made.\n" : "\n"}No action is required from you at this time.`,
        },
      };
    } catch (error) {
      // Rollback Entra ID if DynamoDB operation failed
      if (entraRemoveSucceeded && entraGroupId) {
        logger.error(
          `DynamoDB operation failed for ${username} in ${orgId}. Rolling back Entra group removal.`,
        );
        try {
          await modifyGroup(
            entraIdToken,
            username,
            entraGroupId,
            EntraGroupActions.ADD,
            dynamoClient,
          );
          logger.info(
            `Successfully rolled back Entra group removal for ${username}.`,
          );
        } catch (rollbackError) {
          logger.error(
            `CRITICAL: Failed to rollback Entra group removal for ${username} in ${orgId}. Manual intervention required.`,
            rollbackError,
          );
        }
      }

      // Re-throw the original error
      throw error;
    }
  });
};

/**
 * Returns all voting org leads across all organizations.
 * Uses consistent reads to avoid eventual consistency issues.
 * @param dynamoClient A DynamoDB client.
 * @param logger A logger instance.
 */
export async function getAllVotingLeads({
  dynamoClient,
  logger,
}: {
  dynamoClient: DynamoDBClient;
  logger: ValidLoggers;
}): Promise<
  Array<{ username: string; org: string; name: string; title: string }>
> {
  // Query all organizations in parallel for better performance
  const queryPromises = AllOrganizationNameList.map(async (orgName) => {
    const leadsQuery = new QueryCommand({
      TableName: genericConfig.SigInfoTableName,
      KeyConditionExpression: "primaryKey = :leadName",
      ExpressionAttributeValues: {
        ":leadName": { S: `LEAD#${orgName}` },
      },
      ConsistentRead: true,
    });

    try {
      const responseMarshall = await dynamoClient.send(leadsQuery);
      if (responseMarshall.Items) {
        return responseMarshall.Items.map((x) => unmarshall(x))
          .filter((x) => x.username && !x.nonVotingMember)
          .map((x) => ({
            username: x.username as string,
            org: orgName,
            name: x.name as string,
            title: x.title as string,
          }));
      }
      return [];
    } catch (e) {
      if (e instanceof BaseError) {
        throw e;
      }
      logger.error(e);
      throw new DatabaseFetchError({
        message: `Failed to get leads for org ${orgName}.`,
      });
    }
  });

  const results = await Promise.all(queryPromises);
  return results.flat();
}

/**
 * Checks if a user should remain in exec council by verifying they are a voting lead of at least one org.
 * Uses consistent reads to avoid eventual consistency issues.
 * @param username The username to check.
 * @param dynamoClient A DynamoDB client.
 * @param logger A logger instance.
 */
export async function shouldBeInExecCouncil({
  username,
  dynamoClient,
  logger,
}: {
  username: string;
  dynamoClient: DynamoDBClient;
  logger: ValidLoggers;
}): Promise<boolean> {
  // Query all orgs to see if this user is a voting lead of any org
  for (const orgName of AllOrganizationNameList) {
    const leadsQuery = new QueryCommand({
      TableName: genericConfig.SigInfoTableName,
      KeyConditionExpression: "primaryKey = :leadName AND entryId = :username",
      ExpressionAttributeValues: {
        ":leadName": { S: `LEAD#${orgName}` },
        ":username": { S: username },
      },
      ConsistentRead: true,
    });

    try {
      const responseMarshall = await dynamoClient.send(leadsQuery);
      if (responseMarshall.Items && responseMarshall.Items.length > 0) {
        const lead = unmarshall(responseMarshall.Items[0]);
        // If they're a lead and not a non-voting member, they should be in exec
        if (!lead.nonVotingMember) {
          return true;
        }
      }
    } catch (e) {
      if (e instanceof BaseError) {
        throw e;
      }
      logger.error(e);
      throw new DatabaseFetchError({
        message: `Failed to check lead status for ${username} in org ${orgName}.`,
      });
    }
  }

  return false;
}
