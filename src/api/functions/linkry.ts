import {
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { intersection } from "api/plugins/auth.js";
import { ValidLoggers } from "api/types.js";
import { LinkryGroupUUIDToGroupNameMap } from "common/config.js";
import { UnauthorizedError } from "common/errors/index.js";
import { AppRoles } from "common/roles.js";
import { LinkRecord, OrgLinkRecord } from "common/types/linkry.js";
import { FastifyRequest } from "fastify";

export async function fetchLinkEntry(
  slug: string,
  tableName: string,
  dynamoClient: DynamoDBClient,
): Promise<LinkRecord | null> {
  const fetchLinkEntry = new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "slug = :slug",
    ExpressionAttributeValues: {
      ":slug": { S: slug },
    },
    ScanIndexForward: false,
  });
  const result = await dynamoClient.send(fetchLinkEntry);
  if (!result.Items || result.Items.length === 0) {
    return null;
  }
  const unmarshalled = result.Items.map((x) => unmarshall(x));
  const ownerRecord = unmarshalled.filter((x) =>
    (x.access as string).startsWith("OWNER#"),
  )[0];
  return {
    ...ownerRecord,
    access: unmarshalled
      .filter((x) => (x.access as string).startsWith("GROUP#"))
      .map((x) => (x.access as string).replace("GROUP#", "")),
    owner: ownerRecord.access.replace("OWNER#", ""),
  } as LinkRecord;
}

export async function fetchOwnerRecords(
  username: string,
  tableName: string,
  dynamoClient: DynamoDBClient,
) {
  const fetchAllOwnerRecords = new QueryCommand({
    TableName: tableName,
    IndexName: "AccessIndex",
    KeyConditionExpression: "#access = :accessVal",
    ExpressionAttributeNames: {
      "#access": "access",
    },
    ExpressionAttributeValues: {
      ":accessVal": { S: `OWNER#${username}` },
    },
    ScanIndexForward: false,
  });

  const result = await dynamoClient.send(fetchAllOwnerRecords);

  // Process the results
  return (result.Items || []).map((item) => {
    const unmarshalledItem = unmarshall(item);

    // Strip '#' from access field
    if (unmarshalledItem.access) {
      unmarshalledItem.access =
        unmarshalledItem.access.split("#")[1] || unmarshalledItem.access;
    }

    return unmarshalledItem as LinkRecord;
  });
}

export async function fetchOrgRecords(
  orgId: string,
  tableName: string,
  dynamoClient: DynamoDBClient,
) {
  const fetchAllOwnerRecords = new QueryCommand({
    TableName: tableName,
    IndexName: "AccessIndex",
    KeyConditionExpression: "#access = :accessVal",
    ExpressionAttributeNames: {
      "#access": "access",
    },
    ExpressionAttributeValues: {
      ":accessVal": { S: `OWNER#${orgId}` },
    },
    ScanIndexForward: false,
  });

  const result = await dynamoClient.send(fetchAllOwnerRecords);

  // Process the results
  return (result.Items || []).map((item) => {
    const unmarshalledItem = unmarshall(item);

    // Strip '#' from access field
    if (unmarshalledItem.access) {
      unmarshalledItem.access =
        unmarshalledItem.access.split("#")[1] || unmarshalledItem.access;
    }

    return unmarshalledItem as OrgLinkRecord;
  });
}

export function extractUniqueSlugs(records: LinkRecord[]) {
  return Array.from(
    new Set(records.filter((item) => item.slug).map((item) => item.slug)),
  );
}

export async function getGroupsForSlugs(
  slugs: string[],
  ownerRecords: LinkRecord[],
  tableName: string,
  dynamoClient: DynamoDBClient,
) {
  const groupsPromises = slugs.map(async (slug) => {
    const groupQueryCommand = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression:
        "#slug = :slugVal AND begins_with(#access, :accessVal)",
      ExpressionAttributeNames: {
        "#slug": "slug",
        "#access": "access",
      },
      ExpressionAttributeValues: {
        ":slugVal": { S: slug },
        ":accessVal": { S: "GROUP#" },
      },
      ScanIndexForward: false,
    });

    try {
      const response = await dynamoClient.send(groupQueryCommand);
      const groupItems = (response.Items || []).map((item) => unmarshall(item));
      const groupIds = groupItems.map((item) =>
        item.access.replace("GROUP#", ""),
      );
      const originalRecord =
        ownerRecords.find((item) => item.slug === slug) || {};

      return {
        ...originalRecord,
        access: groupIds,
      };
    } catch (error) {
      console.error(`Error fetching groups for slug ${slug}:`, error);
      const originalRecord =
        ownerRecords.find((item) => item.slug === slug) || {};
      return {
        ...originalRecord,
        access: [],
      };
    }
  });

  const results = await Promise.allSettled(groupsPromises);

  return results
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
}

export function getFilteredUserGroups(request: FastifyRequest) {
  const userGroupMembershipIds = request.tokenPayload?.groups || [];
  return userGroupMembershipIds.filter((groupId) =>
    [...LinkryGroupUUIDToGroupNameMap.keys()].includes(groupId),
  );
}

export async function getAllLinks(
  tableName: string,
  dynamoClient: DynamoDBClient,
): Promise<LinkRecord[]> {
  const scan = new ScanCommand({
    TableName: tableName,
  });
  const response = await dynamoClient.send(scan);
  const unmarshalled = (response.Items || []).map((item) => unmarshall(item));
  const ownerRecords = unmarshalled.filter((x) =>
    (x.access as string).startsWith("OWNER#"),
  );
  const delegations = unmarshalled.filter(
    (x) => !(x.access as string).startsWith("OWNER#"),
  );
  const accessGroupMap: Record<string, string[]> = {}; // maps slug to access groups
  for (const deleg of delegations) {
    if (deleg.slug in accessGroupMap) {
      accessGroupMap[deleg.slug].push(deleg.access.replace("GROUP#", ""));
    } else {
      accessGroupMap[deleg.slug] = [deleg.access.replace("GROUP#", "")];
    }
  }
  return ownerRecords.map((x) => ({
    ...x,
    access: accessGroupMap[x.slug],
    owner: x.access.replace("OWNER#", ""),
  })) as LinkRecord[];
}

export async function getDelegatedLinks(
  userGroups: string[],
  ownedSlugs: string[],
  tableName: string,
  dynamoClient: DynamoDBClient,
  logger: ValidLoggers,
): Promise<LinkRecord[]> {
  const groupQueries = userGroups.map(async (groupId) => {
    try {
      const groupQueryCommand = new QueryCommand({
        TableName: tableName,
        IndexName: "AccessIndex",
        KeyConditionExpression: "#access = :accessVal",
        ExpressionAttributeNames: {
          "#access": "access",
        },
        ExpressionAttributeValues: {
          ":accessVal": { S: `GROUP#${groupId}` },
        },
      });

      const response = await dynamoClient.send(groupQueryCommand);
      const items = (response.Items || []).map((item) => unmarshall(item));

      // Get unique only
      const delegatedSlugs = [
        ...new Set(
          items
            .filter((item) => item.slug && !ownedSlugs.includes(item.slug))
            .map((item) => item.slug),
        ),
      ];

      if (!delegatedSlugs.length) {
        return [];
      }

      // Fetch entry records
      const results = await Promise.all(
        delegatedSlugs.map(async (slug) => {
          try {
            const ownerQuery = new QueryCommand({
              TableName: tableName,
              KeyConditionExpression:
                "#slug = :slugVal AND begins_with(#access, :ownerVal)",
              ExpressionAttributeNames: {
                "#slug": "slug",
                "#access": "access",
              },
              ExpressionAttributeValues: {
                ":slugVal": { S: slug },
                ":ownerVal": { S: "OWNER#" },
              },
            });

            const ownerResponse = await dynamoClient.send(ownerQuery);
            const ownerRecord = ownerResponse.Items
              ? unmarshall(ownerResponse.Items[0])
              : null;

            if (!ownerRecord) {
              return null;
            }
            const groupQuery = new QueryCommand({
              TableName: tableName,
              KeyConditionExpression:
                "#slug = :slugVal AND begins_with(#access, :groupVal)",
              ExpressionAttributeNames: {
                "#slug": "slug",
                "#access": "access",
              },
              ExpressionAttributeValues: {
                ":slugVal": { S: slug },
                ":groupVal": { S: "GROUP#" },
              },
            });

            const groupResponse = await dynamoClient.send(groupQuery);
            const groupItems = (groupResponse.Items || []).map((item) =>
              unmarshall(item),
            );
            const groupIds = groupItems.map((item) =>
              item.access.replace("GROUP#", ""),
            );
            return {
              ...ownerRecord,
              access: groupIds,
              owner: ownerRecord.access.replace("OWNER#", ""),
            } as LinkRecord;
          } catch (error) {
            logger.error(`Error processing delegated slug ${slug}:`, error);
            return null;
          }
        }),
      );

      return results.filter(Boolean).filter((x) => x && !x.isOrgOwned);
    } catch (error) {
      logger.error(`Error processing group ${groupId}:`, error);
      return [];
    }
  });
  const results = await Promise.allSettled(groupQueries);
  const allDelegatedLinks = results
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value);
  const slugMap = new Map();
  allDelegatedLinks.forEach((link) => {
    if (link && link.slug && !slugMap.has(link.slug)) {
      slugMap.set(link.slug, link);
    }
  });

  return Array.from(slugMap.values());
}

type AuthenticatedRequest = FastifyRequest & {
  username: string;
  userRoles: Set<string>;
  tokenPayload?: { groups?: string[] };
};

type AuthorizeLinkAccessOptions = {
  /** If true, owners are allowed access even without delegated groups */
  allowOwner?: boolean;
  /** Custom error message */
  errorMessage?: string;
};

/**
 * Checks if the user has access to a link record via:
 * 1. Being a LINKS_ADMIN
 * 2. Being the owner (if allowOwner is true, which is the default)
 * 3. Having a mutual group in the access list
 *
 * @throws UnauthorizedError if the user doesn't have access
 */
export function authorizeLinkAccess(
  request: AuthenticatedRequest,
  record: LinkRecord,
  options: AuthorizeLinkAccessOptions = {},
): void {
  const { allowOwner = true, errorMessage } = options;

  // Admins always have access
  if (request.userRoles.has(AppRoles.LINKS_ADMIN)) {
    return;
  }

  const isOwner = record.owner === request.username;

  // Check ownership if allowed
  if (allowOwner && isOwner) {
    return;
  }

  // Check delegated access via groups
  const userGroups = new Set(request.tokenPayload?.groups || []);
  const recordGroups = new Set(record.access);
  const mutualGroups = intersection(recordGroups, userGroups);

  if (mutualGroups.size > 0) {
    return;
  }

  // No access - throw appropriate error
  throw new UnauthorizedError({
    message:
      errorMessage ||
      "You do not own this record and have not been delegated access.",
  });
}
