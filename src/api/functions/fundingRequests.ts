import {
  type DynamoDBClient,
  QueryCommand,
  type QueryCommandInput,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { type FastifyBaseLogger } from "fastify";
import { type OrganizationId } from "@acm-uiuc/js-shared";
import { genericConfig } from "common/config.js";
import { AppRoles } from "common/roles.js";
import { DatabaseFetchError } from "common/errors/index.js";
import {
  type FundingRequestListItem,
  type FundingRequestListResponse,
} from "common/types/fundingRequest.js";
import { getUserOrgRoles } from "./organizations.js";

/**
 * Which funding requests a user is allowed to see.
 * - "all": the user has the view-all role (treasurer, infra, etc.)
 * - a list of org IDs: the orgs the user leads
 */
export type FundingRequestScope = "all" | OrganizationId[];

export async function getFundingRequestScope({
  username,
  userRoles,
  dynamoClient,
  logger,
}: {
  username: string;
  userRoles: Set<AppRoles> | undefined;
  dynamoClient: DynamoDBClient;
  logger: FastifyBaseLogger;
}): Promise<FundingRequestScope> {
  if (userRoles?.has(AppRoles.FUNDING_REQUEST_VIEW_ALL)) {
    return "all";
  }
  const orgRoles = await getUserOrgRoles({ username, dynamoClient, logger });
  return [
    ...new Set(orgRoles.filter((x) => x.role === "LEAD").map((x) => x.org)),
  ];
}

const LIST_FIELDS = [
  "requestId",
  "semesterId",
  "orgId",
  "type",
  "title",
  "requestedAmountCents",
  "approvedAmountCents",
  "currentStatus",
  "createdBy",
  "createdAt",
] as const;

const projection = {
  ProjectionExpression: LIST_FIELDS.map((_, i) => `#f${i}`).join(", "),
  ExpressionAttributeNames: Object.fromEntries(
    LIST_FIELDS.map((field, i) => [`#f${i}`, field]),
  ),
};

async function queryAllPages(
  dynamoClient: DynamoDBClient,
  input: QueryCommandInput,
) {
  const items: Record<string, unknown>[] = [];
  let exclusiveStartKey: QueryCommandInput["ExclusiveStartKey"];
  do {
    const response = await dynamoClient.send(
      new QueryCommand({ ...input, ExclusiveStartKey: exclusiveStartKey }),
    );
    if (!response.Items) {
      throw new DatabaseFetchError({
        message: "Could not get funding requests.",
      });
    }
    items.push(...response.Items.map((x) => unmarshall(x)));
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

/**
 * Lists the funding requests in a semester that fall within the given scope,
 * newest first.
 */
export async function listFundingRequests({
  semesterId,
  scope,
  dynamoClient,
}: {
  semesterId: string;
  scope: FundingRequestScope;
  dynamoClient: DynamoDBClient;
}): Promise<FundingRequestListResponse> {
  const TableName = genericConfig.FundingRequestsTableName;
  let queries: QueryCommandInput[];
  if (scope === "all") {
    queries = [
      {
        TableName,
        KeyConditionExpression: "semesterId = :semesterId",
        ExpressionAttributeValues: { ":semesterId": { S: semesterId } },
        ...projection,
      },
    ];
  } else {
    // Sort key is "orgId#requestId", so each org's requests share a prefix.
    queries = scope.map((orgId) => ({
      TableName,
      KeyConditionExpression:
        "semesterId = :semesterId AND begins_with(#sortKey, :orgPrefix)",
      ExpressionAttributeValues: {
        ":semesterId": { S: semesterId },
        ":orgPrefix": { S: `${orgId}#` },
      },
      ProjectionExpression: projection.ProjectionExpression,
      ExpressionAttributeNames: {
        ...projection.ExpressionAttributeNames,
        "#sortKey": "orgId#requestId",
      },
    }));
  }

  const results = await Promise.all(
    queries.map((q) => queryAllPages(dynamoClient, q)),
  );

  return results
    .flat()
    .map(({ currentStatus, ...rest }) => ({ ...rest, status: currentStatus }))
    .map((item) => item as FundingRequestListItem)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
