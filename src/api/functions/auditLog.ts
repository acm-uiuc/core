import {
  DynamoDBClient,
  PutItemCommand,
  type TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { genericConfig } from "common/config.js";
import { AUDIT_LOG_RETENTION_DAYS } from "common/constants.js";
import { AuditLogEntry } from "common/types/logs.js";

type AuditLogParams = {
  dynamoClient?: DynamoDBClient;
  entry: AuditLogEntry;
};

function buildMarshalledAuditLogItem(entry: AuditLogEntry) {
  const baseNow = Date.now();
  const timestamp = Math.floor(baseNow / 1000);
  const expireAt =
    timestamp +
    Math.floor((AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000) / 1000);

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
