import {
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { SigDetailRecord, SigMemberRecord } from "common/types/siglead.js";
import { FastifyRequest } from "fastify";

export async function fetchMemberRecords(
  sigid: string,
  tableName: string,
  dynamoClient: DynamoDBClient,
) {
  const fetchSigMemberRecords = new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "#sigid = :accessVal",
    ExpressionAttributeNames: {
      "#sigid": "sigGroupId",
    },
    ExpressionAttributeValues: {
      ":accessVal": { S: sigid },
    },
    ScanIndexForward: false,
  });

  const result = await dynamoClient.send(fetchSigMemberRecords);

  // Process the results
  return (result.Items || []).map((item) => {
    const unmarshalledItem = unmarshall(item);
    return unmarshalledItem as SigMemberRecord;
  });
}

export async function fetchSigDetail(
  sigid: string,
  tableName: string,
  dynamoClient: DynamoDBClient,
) {
  const fetchSigDetail = new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "#sigid = :accessVal",
    ExpressionAttributeNames: {
      "#sigid": "sigid",
    },
    ExpressionAttributeValues: {
      ":accessVal": { S: sigid },
    },
    ScanIndexForward: false,
  });

  const result = await dynamoClient.send(fetchSigDetail);

  // Process the results
  return (result.Items || [{}]).map((item) => {
    const unmarshalledItem = unmarshall(item);

    // Strip '#' from access field
    delete unmarshalledItem.leadGroupId;
    delete unmarshalledItem.memberGroupId;

    return unmarshalledItem as SigDetailRecord;
  })[0];
}
