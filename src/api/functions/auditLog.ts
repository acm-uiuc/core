import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { genericConfig } from "common/config.js";
import { Modules } from "common/modules.js";

export type AuditLogEntry = {
  module: Modules;
  actor: string;
  target: string;
  requestId?: string;
  message: string;
};

type AuditLogParams = {
  dynamoClient?: DynamoDBClient;
  entry: AuditLogEntry;
};

const RETENTION_DAYS = 365;

export async function createAuditLogEntry({
  dynamoClient,
  entry,
}: AuditLogParams) {
  const baseNow = Date.now();
  const timestamp = Math.floor(baseNow / 1000);
  const expireAt =
    timestamp + Math.floor((RETENTION_DAYS * 24 * 60 * 60 * 1000) / 1000);
  if (!dynamoClient) {
    dynamoClient = new DynamoDBClient({
      region: genericConfig.AwsRegion,
    });
  }
  const augmentedEntry = marshall({ ...entry, createdAt: timestamp, expireAt });
  const command = new PutItemCommand({
    TableName: genericConfig.AuditLogTable,
    Item: augmentedEntry,
  });
  return dynamoClient.send(command);
}
