import { afterAll, expect, test, beforeEach } from "vitest";
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import init from "../../src/api/index.js";
import { describe } from "node:test";
import { mockClient } from "aws-sdk-client-mock";
import { genericConfig } from "../../src/common/config.js";

const app = await init();
const ddbMock = mockClient(DynamoDBClient);

const acmMeta = {
  primaryKey: "DEFINE#ACM",
  leadsEntraGroup: "a3c37a24-1e21-4338-813f-15478eb40137",
  links: [
    {
      type: "DISCORD",
      url: "https://go.acm.illinois.edu/discord",
    },
  ],
  website: "https://www.acm.illinois.edu",
};
describe("Organization info tests", async () => {
  test("Test getting the list of organizations succeeds", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/organizations",
    });
    expect(response.statusCode).toBe(200);
    await response.json();
  });
  test("Test getting info about an org succeeds", async () => {
    ddbMock
      .on(GetItemCommand, {
        TableName: genericConfig.SigInfoTableName,
        Key: { primaryKey: { S: "DEFINE#ACM" } },
      })
      .resolves({
        Item: marshall(acmMeta),
      });
    ddbMock
      .on(QueryCommand, {
        TableName: genericConfig.SigInfoTableName,
        KeyConditionExpression: "primaryKey = :leadName",
        ExpressionAttributeValues: {
          ":leadName": { S: "LEAD#ACM" },
        },
      })
      .resolves({
        Items: [
          {
            primaryKey: "LEAD#ACM",
            name: "John Doe",
            title: "Chair",
            username: "jdoe@illinois.edu",
          },
        ].map((x) => marshall(x)),
      });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/organizations/ACM",
    });
    expect(response.statusCode).toBe(200);
    const responseJson = await response.json();
    expect(responseJson).toStrictEqual({
      id: "ACM",
      website: "https://www.acm.illinois.edu",
      leads: [
        {
          username: "jdoe@illinois.edu",
          name: "John Doe",
          title: "Chair",
        },
      ],
      links: [
        {
          type: "DISCORD",
          url: "https://go.acm.illinois.edu/discord",
        },
      ],
    });
  });
  test("Test getting info about an unknown valid org returns just the ID", async () => {
    ddbMock
      .on(GetItemCommand, {
        TableName: genericConfig.SigInfoTableName,
        Key: { primaryKey: { S: "DEFINE#ACM" } },
      })
      .resolves({
        Item: undefined,
      });
    ddbMock
      .on(QueryCommand, {
        TableName: genericConfig.SigInfoTableName,
        KeyConditionExpression: "primaryKey = :leadName",
        ExpressionAttributeValues: {
          ":leadName": { S: "LEAD#ACM" },
        },
      })
      .rejects();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/organizations/ACM",
    });
    expect(response.statusCode).toBe(200);
    const responseJson = await response.json();
    expect(responseJson).toStrictEqual({
      id: "ACM",
    });
  });
  test("Test that getting org with no leads succeeds", async () => {
    ddbMock
      .on(GetItemCommand, {
        TableName: genericConfig.SigInfoTableName,
        Key: { primaryKey: { S: "DEFINE#ACM" } },
      })
      .resolves({
        Item: marshall(acmMeta),
      });
    ddbMock
      .on(QueryCommand, {
        TableName: genericConfig.SigInfoTableName,
        KeyConditionExpression: "primaryKey = :leadName",
        ExpressionAttributeValues: {
          ":leadName": { S: "LEAD#ACM" },
        },
      })
      .resolves({ Items: [] });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/organizations/ACM",
    });
    expect(response.statusCode).toBe(200);
    const responseJson = await response.json();
    expect(responseJson).toStrictEqual({
      id: "ACM",
      website: "https://www.acm.illinois.edu",
      leads: [],
      links: [
        {
          type: "DISCORD",
          url: "https://go.acm.illinois.edu/discord",
        },
      ],
    });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    (app as any).nodeCache.flushAll();
  });
});
