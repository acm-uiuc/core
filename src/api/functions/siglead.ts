import {
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import {
  SigDetailRecord,
  SigMemberCount,
  SigMemberRecord,
} from "common/types/siglead.js";

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

// select count(sigid)
// from table
// groupby sigid
export async function fetchSigCounts(
  sigMemberTableName: string,
  dynamoClient: DynamoDBClient,
) {
  const scan = new ScanCommand({
    TableName: sigMemberTableName,
    ProjectionExpression: "sigGroupId",
  });

  const result = await dynamoClient.send(scan);

  const counts: Record<string, number> = {};

  (result.Items || []).forEach((item) => {
    const sigGroupId = item.sigGroupId?.S;
    if (sigGroupId) {
      counts[sigGroupId] = (counts[sigGroupId] || 0) + 1;
    }
  });

  const countsArray: SigMemberCount[] = Object.entries(counts).map(
    ([sigid, count]) => ({
      sigid,
      count,
    }),
  );
  console.log(countsArray);
  return countsArray;
}
