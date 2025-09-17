import { AllOrganizationList } from "@acm-uiuc/js-shared";
import {
  GetItemCommand,
  QueryCommand,
  type DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { genericConfig } from "common/config.js";
import {
  BaseError,
  DatabaseFetchError,
  ValidationError,
} from "common/errors/index.js";
import { OrgRole, orgRoles } from "common/roles.js";
import { getOrganizationInfoResponse } from "common/types/organizations.js";
import { type FastifyBaseLogger } from "fastify";
import pino from "pino";
import z from "zod";

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

export async function getOrgInfo({
  id,
  dynamoClient,
  logger,
}: GetOrgInfoInputs) {
  const query = new GetItemCommand({
    TableName: genericConfig.SigInfoTableName,
    Key: { primaryKey: { S: `DEFINE#${id}` } },
  });
  let response = { leads: [] } as {
    leads: { name: string; username: string; title: string | undefined }[];
  };
  try {
    const responseMarshall = await dynamoClient.send(query);
    if (!responseMarshall.Item) {
      throw new ValidationError({
        message: "No information found for this organization.",
      });
    }
    const temp = unmarshall(responseMarshall.Item);
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
    if (!response.Items) {
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
