import { afterAll, expect, test } from "vitest";
import init from "../../src/api/server.js";
import { createJwt } from "./utils.js";
import supertest from "supertest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { genericConfig } from "../../src/common/config.js";

const app = await init();
const ddbMock = mockClient(DynamoDBClient);

test("Test getting email for UIN", async () => {
  ddbMock
    .on(QueryCommand, {
      TableName: genericConfig.UserInfoTable,
      IndexName: "UinIndex",
      KeyConditionExpression: "uin = :uin",
      ExpressionAttributeValues: {
        ":uin": { S: "627838939" },
      },
    })
    .resolvesOnce({
      Items: [{ id: { S: "UIN#testinguser@illinois.edu" } }],
    })
    .rejects();
  const testJwt = createJwt();
  await app.ready();
  const response = await supertest(app.server)
    .post("/api/v1/users/findUserByUin")
    .set("authorization", `Bearer ${testJwt}`)
    .send({ uin: "627838939" });
  const responseDataJson = response.body;
  expect(response.statusCode).toEqual(200);
  expect(responseDataJson).toEqual({
    email: "testinguser@illinois.edu",
  });
});
afterAll(async () => {
  await app.close();
});
