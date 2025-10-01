import { AllOrganizationList } from "@acm-uiuc/js-shared";
import {
  QueryCommand,
  TransactWriteItemsCommand,
  type DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { genericConfig } from "common/config.js";
import {
  BaseError,
  DatabaseFetchError,
  ValidationError,
} from "common/errors/index.js";
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

export interface GetOrgInfoInputs {
  id: string;
  dynamoClient: DynamoDBClient;
  logger: FastifyBaseLogger | pino.Logger;
}

export interface GetUserOrgRolesInputs {
  username: string;
  dynamoClient: DynamoDBClient;
  logger: FastifyBaseLogger | pino.Logger;
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
  // Get leads
  const leadsQuery = new QueryCommand({
    TableName: genericConfig.SigInfoTableName,
    KeyConditionExpression: "primaryKey = :leadName",
    ExpressionAttributeValues: {
      ":leadName": { S: `LEAD#${id}` },
    },
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
      if (!AllOrganizationList.includes(org)) {
        logger.warn(`Invalid org in role definition: ${JSON.stringify(item)}`);
        continue;
      }
      cleanedRoles.push({
        org,
        role,
      } as { org: (typeof AllOrganizationList)[number]; role: OrgRole });
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

/**
 * Adds a user as a lead, handling DB, Entra sync, and returning an email payload.
 * It will only succeed if the user is not already a lead, preventing race conditions.
 * @returns SQSMessage payload for email notification, or null if the user is already a lead.
 */
export const addLead = async ({
  user,
  orgId,
  actorUsername,
  reqId,
  entraGroupId,
  entraIdToken,
  dynamoClient,
  logger,
  execGroupId,
  officersEmail,
}: {
  user: z.infer<typeof enforcedOrgLeadEntry>;
  orgId: string;
  actorUsername: string;
  reqId: string;
  entraGroupId?: string;
  entraIdToken: string;
  dynamoClient: DynamoDBClient;
  logger: FastifyBaseLogger;
  execGroupId: string;
  officersEmail: string;
}): Promise<SQSMessage | null> => {
  const { username } = user;

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
          Item: marshall({
            ...user,
            primaryKey: `LEAD#${orgId}`,
            entryId: username,
            updatedAt: new Date().toISOString(),
          }),
          // This condition ensures the Put operation fails if an item with this primary key already exists.
          ConditionExpression: "attribute_not_exists(primaryKey)",
        },
      },
    ],
  });

  try {
    await dynamoClient.send(addTransaction);
  } catch (e: any) {
    // This specific error is thrown when a ConditionExpression fails.
    if (
      e.name === "TransactionCanceledException" &&
      e.message.includes("ConditionalCheckFailed")
    ) {
      logger.info(
        `User ${username} is already a lead for ${orgId}. Skipping add operation.`,
      );
      return null; // Gracefully exit without erroring.
    }
    throw e; // Re-throw any other type of error.
  }

  logger.info(
    `Successfully added ${username} as lead for ${orgId} in DynamoDB.`,
  );

  const promises = [
    modifyGroup(
      entraIdToken,
      username,
      execGroupId,
      EntraGroupActions.ADD,
      dynamoClient,
    ),
  ];

  if (entraGroupId) {
    promises.push(
      modifyGroup(
        entraIdToken,
        username,
        entraGroupId,
        EntraGroupActions.ADD,
        dynamoClient,
      ),
    );
  }

  await Promise.all(promises);

  logger.info(`Successfully added ${username} to ACM Exec Entra group.`);
  if (entraGroupId) {
    logger.info(`Successfully added ${username} to Entra group for ${orgId}.`);
  }

  return {
    function: AvailableSQSFunctions.EmailNotifications,
    metadata: { initiator: actorUsername, reqId },
    payload: {
      to: getAllUserEmails(username),
      cc: [officersEmail],
      subject: `Lead added for ${orgId}`,
      content: `Hello,\n\nWe're letting you know that ${username} has been added as a lead for ${orgId} by ${actorUsername}. Changes may take up to 2 hours to reflect in all systems.\n\nNo action is required from you at this time.`,
    },
  };
};

/**
 * Removes a user as a lead, handling DB, Entra sync, and returning an email payload.
 * It will only succeed if the user is currently a lead, and attempts to avoid race conditions in Exec group management.
 * @returns SQSMessage payload for email notification, or null if the user was not a lead.
 */
export const removeLead = async ({
  username,
  orgId,
  actorUsername,
  reqId,
  entraGroupId,
  entraIdToken,
  dynamoClient,
  logger,
  execGroupId,
  officersEmail,
}: {
  username: string;
  orgId: string;
  actorUsername: string;
  reqId: string;
  entraGroupId?: string;
  entraIdToken: string;
  dynamoClient: DynamoDBClient;
  logger: FastifyBaseLogger;
  execGroupId: string;
  officersEmail: string;
}): Promise<SQSMessage | null> => {
  const getDelayed = async () => {
    // HACK: wait up to 30ms in an attempt to de-sync the threads on checking leads.
    // Yes, I know this is bad. But because of a lack of consistent reads on Dynamo GSIs,
    // we're going to have to run with it for now.
    const sleepMs = Math.random() * 30;
    logger.info(`Sleeping for ${sleepMs}ms before checking.`);
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
    return getUserOrgRoles({ username, dynamoClient, logger });
  };
  const userRolesPromise = getDelayed();
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
          // Idempotent
          ConditionExpression: "attribute_exists(primaryKey)",
        },
      },
    ],
  });

  try {
    await dynamoClient.send(removeTransaction);
  } catch (e: any) {
    // This specific error is thrown when a ConditionExpression fails, meaning we do nothing.
    if (
      e.name === "TransactionCanceledException" &&
      e.message.includes("ConditionalCheckFailed")
    ) {
      logger.info(
        `User ${username} was not a lead for ${orgId}. Skipping remove operation.`,
      );
      return null;
    }
    throw e;
  }

  logger.info(
    `Successfully removed ${username} as lead for ${orgId} in DynamoDB.`,
  );

  if (entraGroupId) {
    await modifyGroup(
      entraIdToken,
      username,
      entraGroupId,
      EntraGroupActions.REMOVE,
      dynamoClient,
    );
    logger.info(
      `Successfully removed ${username} from Entra group for ${orgId}.`,
    );
  }

  const userRoles = await userRolesPromise;
  // Since the read is eventually consistent, don't count the role we just removed if it still gets returned.
  const otherLeadRoles = userRoles
    .filter((x) => x.role === "LEAD")
    .filter((x) => x.org !== orgId);
  if (otherLeadRoles.length === 0) {
    await modifyGroup(
      entraIdToken,
      username,
      execGroupId,
      EntraGroupActions.REMOVE,
      dynamoClient,
    );
    logger.info(`Successfully removed ${username} from ACM Exec Entra group.`);
  } else {
    logger.info(
      `Keeping ${username} in ACM Exec Entra group as they lead: ${JSON.stringify(otherLeadRoles.map((x) => x.org))}.`,
    );
  }

  return {
    function: AvailableSQSFunctions.EmailNotifications,
    metadata: { initiator: actorUsername, reqId },
    payload: {
      to: getAllUserEmails(username),
      cc: [officersEmail],
      subject: `Lead removed for ${orgId}`,
      content: `Hello,\n\nWe're letting you know that ${username} has been removed as a lead for ${orgId} by ${actorUsername}.\n\nNo action is required from you at this time.`,
    },
  };
};
