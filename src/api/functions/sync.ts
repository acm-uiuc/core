import {
  UpdateItemCommand,
  type DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { genericConfig } from "common/config.js";

export interface SyncFullProfileInputs {
  uinHash: string;
  netId: string;
  firstName: string;
  lastName: string;
  dynamoClient: DynamoDBClient;
}

export async function syncFullProfile({
  uinHash,
  netId,
  firstName,
  lastName,
  dynamoClient,
}: SyncFullProfileInputs) {
  return dynamoClient.send(
    new UpdateItemCommand({
      TableName: genericConfig.UserInfoTable,
      Key: {
        id: { S: `${netId}@illinois.edu` },
      },
      UpdateExpression:
        "SET #uinHash = :uinHash, #netId = :netId, #updatedAt = :updatedAt, #firstName = :firstName, #lastName = :lastName",
      ExpressionAttributeNames: {
        "#uinHash": "uinHash",
        "#netId": "netId",
        "#updatedAt": "updatedAt",
        "#firstName": "firstName",
        "#lastName": "lastName",
      },
      ExpressionAttributeValues: {
        ":uinHash": { S: uinHash },
        ":netId": { S: netId },
        ":firstName": { S: firstName },
        ":lastName": { S: lastName },
        ":updatedAt": { S: new Date().toISOString() },
      },
    }),
  );
}
