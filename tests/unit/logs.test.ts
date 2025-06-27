import { afterAll, expect, test, beforeEach, vi } from "vitest";
import init from "../../src/api/index.js";
import { describe } from "node:test";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { testSecretObject } from "./secret.testdata.js";
import supertest from "supertest";
import { createJwt } from "./auth.test.js";
import { genericConfig } from "../../src/common/config.js";
import { marshall } from "@aws-sdk/util-dynamodb";
import { Modules } from "../../src/common/modules.js";

const ddbMock = mockClient(DynamoDBClient);
const jwt_secret = testSecretObject["jwt_key"];
vi.stubEnv("JwtSigningKey", jwt_secret);

const app = await init();
describe("Audit Log tests", async () => {
  test("Sad path: Not authenticated", async () => {
    await app.ready();
    const response = await supertest(app.server)
      .get("/api/v1/logs/events")
      .send();
    expect(response.statusCode).toBe(403);
  });
  test("Sad path: Authenticated but not authorized", async () => {
    await app.ready();
    const testJwt = createJwt(undefined, ["1"]);
    const response = await supertest(app.server)
      .get("/api/v1/logs/events?start=0&end=1")
      .set("Authorization", `Bearer ${testJwt}`)
      .send();
    expect(response.statusCode).toBe(401);
  });
  test("Sad path: No start and end provided", async () => {
    await app.ready();
    const testJwt = createJwt(undefined, ["0"]);
    const response = await supertest(app.server)
      .get("/api/v1/logs/events")
      .set("Authorization", `Bearer ${testJwt}`)
      .send();
    expect(response.statusCode).toBe(400);
    expect(response.body).toStrictEqual({
      error: true,
      name: "ValidationError",
      id: 104,
      message:
        "querystring/start Expected number, received nan, querystring/end Expected number, received nan",
    });
  });
  test("Sad path: Items is undefined", async () => {
    const logEntry = {
      module: Modules.EVENTS,
      actor: "me",
      target: "you",
      requestId: "c03ddefa-11d7-4b7c-a6d5-771460e1b45f",
      message: "no!",
    };
    ddbMock
      .on(QueryCommand, {
        TableName: genericConfig.AuditLogTable,
        KeyConditionExpression: "#pk = :module AND #sk BETWEEN :start AND :end",
        ExpressionAttributeNames: {
          "#pk": "module",
          "#sk": "createdAt",
        },
        ExpressionAttributeValues: {
          ":module": { S: "events" },
          ":start": { N: "1750349770" },
          ":end": { N: "1750436176" },
        },
      })
      .resolvesOnce({
        Items: [marshall(logEntry)],
      });
    await app.ready();
    const testJwt = createJwt(undefined, ["0"]);
    const response = await supertest(app.server)
      .get("/api/v1/logs/events?start=1750349770&end=1750436176")
      .set("Authorization", `Bearer ${testJwt}`)
      .send();
    expect(response.statusCode).toBe(200);
    expect(response.body).toStrictEqual([logEntry]);
  });
  ddbMock
    .on(QueryCommand, {
      TableName: genericConfig.AuditLogTable,
      KeyConditionExpression: "#pk = :module AND #sk BETWEEN :start AND :end",
      ExpressionAttributeNames: {
        "#pk": "module",
        "#sk": "createdAt",
      },
      ExpressionAttributeValues: {
        ":module": { S: "events" },
        ":start": { N: "1750349770" },
        ":end": { N: "1750436176" },
      },
    })
    .resolvesOnce({
      Items: undefined,
    });
  await app.ready();
  const testJwt = createJwt(undefined, ["0"]);
  const response = await supertest(app.server)
    .get("/api/v1/logs/events?start=1750349770&end=1750436176")
    .set("Authorization", `Bearer ${testJwt}`)
    .send();
  expect(response.statusCode).toBe(500);
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  (app as any).nodeCache.flushAll();
  (app as any).redisClient.flushdb();
  ddbMock.reset();
  vi.clearAllMocks();
  vi.useFakeTimers();
});
