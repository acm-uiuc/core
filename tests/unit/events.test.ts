import { afterAll, expect, test, beforeEach, vi } from "vitest";
import {
  ScanCommand,
  DynamoDBClient,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import init from "../../src/api/index.js";
import { EventGetResponse } from "../../src/api/routes/events.js";
import {
  dynamoTableData,
  dynamoTableDataUnmarshalled,
  dynamoTableDataUnmarshalledUpcomingOnly,
  infraEventsOnly,
  infraEventsOnlyUnmarshalled,
} from "./mockEventData.testdata.js";
import { secretObject } from "./secret.testdata.js";

const ddbMock = mockClient(DynamoDBClient);
const jwt_secret = secretObject["jwt_key"];
vi.stubEnv("JwtSigningKey", jwt_secret);

const app = await init();
test("Test getting events", async () => {
  ddbMock.on(ScanCommand).resolves({
    Items: dynamoTableData as any,
  });
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/events",
  });
  expect(response.statusCode).toBe(200);
  const responseDataJson = (await response.json()) as EventGetResponse;
  expect(responseDataJson).toEqual(dynamoTableDataUnmarshalled);
});

test("Test dynamodb error handling", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/events",
  });
  expect(response.statusCode).toBe(500);
  const responseDataJson = await response.json();
  expect(responseDataJson).toEqual({
    error: true,
    name: "DatabaseFetchError",
    id: 106,
    message: "Failed to get events from Dynamo table.",
  });
});

test("Test upcoming only", async () => {
  const date = new Date(2024, 7, 10, 13, 0, 0); // 2024-08-10T17:00:00.000Z, don't ask me why its off a month
  vi.setSystemTime(date);
  ddbMock.on(ScanCommand).resolves({
    Items: dynamoTableData as any,
  });
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/events?upcomingOnly=true",
  });
  expect(response.statusCode).toBe(200);
  const responseDataJson = (await response.json()) as EventGetResponse;
  expect(responseDataJson).toEqual(dynamoTableDataUnmarshalledUpcomingOnly);
});

test("Test host filter", async () => {
  ddbMock.on(ScanCommand).rejects();
  ddbMock.on(QueryCommand).resolves({ Items: infraEventsOnly as any });
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/events?host=Infrastructure Committee",
  });
  expect(response.statusCode).toBe(200);
  const responseDataJson = (await response.json()) as EventGetResponse;
  expect(responseDataJson).toEqual(infraEventsOnlyUnmarshalled);
  expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(1);
  const queryCommandCall = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
  expect(queryCommandCall).toEqual({
    TableName: "infra-core-api-events",
    ExpressionAttributeValues: {
      ":host": {
        S: "Infrastructure Committee",
      },
    },
    KeyConditionExpression: "host = :host",
    IndexName: "HostIndex",
  });
});

afterAll(async () => {
  await app.close();
  vi.useRealTimers();
});
beforeEach(() => {
  (app as any).nodeCache.flushAll();
  ddbMock.reset();
  vi.useFakeTimers();
});
