import {
  DynamoDBClient,
  PutItemCommand,
  type TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { genericConfig } from "common/config.js";
import { AUDIT_LOG_RETENTION_DAYS } from "common/constants.js";
import { ValidationError } from "common/errors/index.js";
import { AuditLogEntry } from "common/types/logs.js";

type AuditLogParams = {
  dynamoClient?: DynamoDBClient;
  entry: AuditLogEntry;
};

function buildMarshalledAuditLogItem(entry: AuditLogEntry) {
  const baseNow = Date.now();
  const timestamp = Math.floor(baseNow / 1000);
  const expireAt = timestamp + AUDIT_LOG_RETENTION_DAYS * 86400;

  return marshall(
    {
      ...entry,
      createdAt: timestamp,
      expireAt,
    },
    { removeUndefinedValues: true },
  );
}

export async function createAuditLogEntry({
  dynamoClient,
  entry,
}: AuditLogParams) {
  if (process.env.DISABLE_AUDIT_LOG && process.env.RunEnvironment === "dev") {
    console.log(`Audit log entry: ${JSON.stringify(entry)}`);
    return;
  }
  const safeDynamoClient =
    dynamoClient ||
    new DynamoDBClient({
      region: genericConfig.AwsRegion,
    });

  const item = buildMarshalledAuditLogItem(entry);

  const command = new PutItemCommand({
    TableName: genericConfig.AuditLogTable,
    Item: item,
  });

  return safeDynamoClient.send(command);
}

export function buildAuditLogTransactPut({
  entry,
}: {
  entry: AuditLogEntry;
}): TransactWriteItem | null {
  if (process.env.DISABLE_AUDIT_LOG && process.env.RunEnvironment === "dev") {
    console.log(`Audit log entry: ${JSON.stringify(entry)}`);
    return null;
  }
  const item = buildMarshalledAuditLogItem(entry);
  return {
    Put: {
      TableName: genericConfig.AuditLogTable,
      Item: item,
    },
  };
}

/**
 * Generates an efficient, partition-aware Athena SQL query for a given time range.
 *
 * @param startTs The start of the time range as a Unix timestamp in seconds.
 * @param endTs The end of the time range as a Unix timestamp in seconds.
 * @param moduleName The name of the module to query.
 * @returns A SQL query string with WHERE clauses for partition pruning and predicate pushdown.
 */
export function buildAthenaQuery(
  startTs: number,
  endTs: number,
  moduleName: string,
): string {
  if (startTs > endTs) {
    throw new ValidationError({
      message: "Start timestamp cannot be after end timestamp.",
    });
  }

  const startDate = new Date(startTs * 1000);
  const endDate = new Date(endTs * 1000);

  const years = new Set<string>();
  const months = new Set<string>();
  const days = new Set<string>();
  const hours = new Set<string>();

  const currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    // Extract UTC components to align with the Unix timestamp's nature
    years.add(currentDate.getUTCFullYear().toString());

    // Pad month, day, and hour with a leading zero if needed
    months.add((currentDate.getUTCMonth() + 1).toString().padStart(2, "0"));
    days.add(currentDate.getUTCDate().toString().padStart(2, "0"));
    hours.add(currentDate.getUTCHours().toString().padStart(2, "0"));

    // Move to the next hour
    currentDate.setUTCHours(currentDate.getUTCHours() + 1);
  }

  const createInClause = (valueSet: Set<string>): string => {
    return Array.from(valueSet)
      .sort()
      .map((value) => `'${value}'`)
      .join(", ");
  };

  const query = `
SELECT *
FROM "logs"
WHERE
  module = "${moduleName}"
  AND year IN (${createInClause(years)})
  AND month IN (${createInClause(months)})
  AND day IN (${createInClause(days)})
  AND hour IN (${createInClause(hours)})
  AND createdAt BETWEEN ${startTs} AND ${endTs};
`;
  return query.trim();
}
