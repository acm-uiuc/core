import {
  AttributeValue,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  PutItemCommandInput,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { DatabaseInsertError } from "common/errors/index.js";
import { OrganizationList, orgIds2Name } from "common/orgs.js";
import {
  SigDetailRecord,
  SigMemberCount,
  SigMemberRecord,
  SigMemberUpdateRecord,
} from "common/types/siglead.js";
import { transformSigLeadToURI } from "common/utils.js";
import { KeyObject } from "crypto";
import { string } from "zod";

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
  // Object.entries(orgIds2Name).forEach(([id, _]) => {
  //   counts[id] = 0;
  // });

  (result.Items || []).forEach((item) => {
    const sigGroupId = item.sigGroupId?.S;
    if (sigGroupId) {
      counts[sigGroupId] = (counts[sigGroupId] || 0) + 1;
    }
  });

  const countsArray: SigMemberCount[] = Object.entries(counts).map(
    ([id, count]) => ({
      sigid: id,
      signame: orgIds2Name[id],
      count,
    }),
  );
  console.log(countsArray);
  return countsArray;
}

export async function addMemberToSigDynamo(
  sigMemberTableName: string,
  sigMemberUpdateRequest: SigMemberUpdateRecord,
  dynamoClient: DynamoDBClient,
) {
  const item: Record<string, AttributeValue> = {};
  Object.entries(sigMemberUpdateRequest).forEach(([k, v]) => {
    item[k] = { S: v };
  });

  // put into table
  const put = new PutItemCommand({
    Item: item,
    ReturnConsumedCapacity: "TOTAL",
    TableName: sigMemberTableName,
  });
  try {
    const response = await dynamoClient.send(put);
    console.log(response);
  } catch (e) {
    console.error("Put to dynamo db went wrong.");
    throw e;
  }

  // fetch from db and check if fetched item update time = input item update time
  const validatePutQuery = new GetItemCommand({
    TableName: sigMemberTableName,
    Key: {
      sigGroupId: { S: sigMemberUpdateRequest.sigGroupId },
      email: { S: sigMemberUpdateRequest.email },
    },
    ProjectionExpression: "updatedAt",
  });

  try {
    const response = await dynamoClient.send(validatePutQuery);
    const item = response.Item;

    if (!item || !item.updatedAt?.S) {
      throw new Error("Item not found or missing 'updatedAt'");
    }

    if (item.updatedAt.S !== sigMemberUpdateRequest.updatedAt) {
      throw new DatabaseInsertError({
        message: "The member exists, but was updated by someone else!",
      });
    }
  } catch (e) {
    console.error("Validate DynamoDB get went wrong.", e);
    throw e;
  }
}

export async function addMemberToSigEntra() {
  // uuid validation not implemented yet
}
