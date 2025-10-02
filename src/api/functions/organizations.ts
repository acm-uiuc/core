import { AllOrganizationList } from "@acm-uiuc/js-shared";
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
}): Promise<SQSMessage | null> => {
  const { username } = user;

  const addOperation = async () => {
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
            ConditionExpression:
              "attribute_not_exists(primaryKey) AND attribute_not_exists(entryId)",
          },
        },
      ],
    });

    return await dynamoClient.send(addTransaction);
  };

  try {
    await retryDynamoTransactionWithBackoff(
      addOperation,
      logger,
      `Add lead ${username} to ${orgId}`,
    );
  } catch (e: any) {
    if (
      e.name === "TransactionCanceledException" &&
      e.message.includes("ConditionalCheckFailed")
    ) {
      logger.info(
        `User ${username} is already a lead for ${orgId}. Skipping add operation.`,
      );
      return null;
    }
    throw e;
  }

  logger.info(
    `Successfully added ${username} as lead for ${orgId} in DynamoDB.`,
  );

  if (entraGroupId) {
    await modifyGroup(
      entraIdToken,
      username,
      entraGroupId,
      EntraGroupActions.ADD,
      dynamoClient,
    );
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
}): Promise<SQSMessage | null> => {
  const removeOperation = async () => {
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

    return await dynamoClient.send(removeTransaction);
  };

  try {
    await retryDynamoTransactionWithBackoff(
      removeOperation,
      logger,
      `Remove lead ${username} from ${orgId}`,
    );
  } catch (e: any) {
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

/**
 * Returns the Microsoft 365 Dynamic User query to return all members of all lead groups.
 * Currently used to setup the Exec member list.
 * @param dynamoClient A DynamoDB client.
 * @param includeGroupIds Used to ensure that a specific group ID is included (Scan could be eventually consistent.)
 */
export async function getLeadsM365DynamicQuery({
  dynamoClient,
  includeGroupIds,
}: {
  dynamoClient: DynamoDBClient;
  includeGroupIds?: string[];
}): Promise<string | null> {
  const command = new ScanCommand({
    TableName: genericConfig.SigInfoTableName,
    IndexName: "LeadsGroupIdIndex",
  });
  const results = await dynamoClient.send(command);
  if (!results || !results.Items || results.Items.length === 0) {
    return null;
  }
  const entries = results.Items.map((x) => unmarshall(x)) as {
    primaryKey: string;
    leadsEntraGroupId: string;
  }[];
  const groupIds = entries
    .filter((x) => x.primaryKey.startsWith("DEFINE#"))
    .map((x) => x.leadsEntraGroupId);

  if (groupIds.length === 0) {
    return null;
  }

  const formattedGroupIds = [
    ...new Set([...(includeGroupIds || []), ...groupIds]),
  ]
    .map((id) => `'${id}'`)
    .join(", ");
  return `user.memberOf -any (group.objectId -in [${formattedGroupIds}])`;
}
