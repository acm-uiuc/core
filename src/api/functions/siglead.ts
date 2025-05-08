import {
  DeleteItemCommand,
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  EntraFetchError,
  EntraGroupError,
  EntraPatchError,
  NotImplementedError,
} from "common/errors/index.js";
import { OrganizationList } from "common/orgs.js";
import {
  SigDetailRecord,
  SigEntraRecord,
  SigMemberCount,
  SigMemberRecord,
} from "common/types/siglead.js";
import { transformSigLeadToURI } from "common/utils.js";
import { string } from "zod";
import { getEntraIdToken, modifyGroup } from "./entraId.js";
import { EntraGroupActions } from "common/types/iam.js";

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

    delete unmarshalledItem.leadGroupId;
    delete unmarshalledItem.memberGroupId;

    return unmarshalledItem as SigDetailRecord;
  })[0];
}

export async function fetchSigEntraDetail(
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

    delete unmarshalledItem.description;

    return unmarshalledItem as SigEntraRecord;
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

  const ids2Name: Record<string, string> = {};
  OrganizationList.forEach((org) => {
    const sigid = transformSigLeadToURI(org);
    ids2Name[sigid] = org;
  });

  const counts: Record<string, number> = {};
  (result.Items || []).forEach((item) => {
    const sigGroupId = item.sigGroupId?.S;
    if (sigGroupId) {
      counts[sigGroupId] = (counts[sigGroupId] || 0) + 1;
    }
  });

  const joined: Record<string, [string, number]> = {};
  Object.keys(counts).forEach((sigid) => {
    joined[sigid] = [ids2Name[sigid], counts[sigid]];
  });

  const countsArray: SigMemberCount[] = Object.entries(joined).map(
    ([sigid, [signame, count]]) => ({
      sigid,
      signame,
      count,
    }),
  );
  console.log(countsArray);
  return countsArray;
}

export async function addMemberRecordToSig(
  newMemberRecord: SigMemberRecord,
  sigMemberTableName: string,
  dynamoClient: DynamoDBClient,
  entraIdToken: string,
) {
  await dynamoClient.send(
    new PutItemCommand({
      TableName: sigMemberTableName,
      Item: marshall(newMemberRecord),
    }),
  );
  try {
    const sigEntraDetails: SigEntraRecord = await fetchSigEntraDetail(
      newMemberRecord.sigGroupId,
      sigMemberTableName,
      dynamoClient,
    );
    await modifyGroup(
      entraIdToken,
      newMemberRecord.email,
      sigEntraDetails.memberGroupId,
      EntraGroupActions.ADD,
      dynamoClient,
    );
  } catch (e: unknown) {
    // restore original Dynamo status if AAD update fails.
    await dynamoClient.send(
      new DeleteItemCommand({
        TableName: sigMemberTableName,
        Key: {
          sigGroupId: { S: newMemberRecord.sigGroupId },
          email: { S: newMemberRecord.email },
        },
      }),
    );
    throw new EntraPatchError({
      message: "Could not add member to sig AAD group.",
      email: newMemberRecord.email,
    });
  }
}
