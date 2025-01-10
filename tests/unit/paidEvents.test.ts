import { afterAll, expect, test, beforeEach, vi } from "vitest";
import {
  ScanCommand,
  DynamoDBClient,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import init from "../../src/api/index.js";
import {
  dynamoTableData,
  dynamoTableDataUnmarshalled,
} from "./mockPaidEventData.testdata.js";
import { secretObject } from "./secret.testdata.js";

const ddbMock = mockClient(DynamoDBClient);
const jwt_secret = secretObject["jwt_key"];
vi.stubEnv("JwtSigningKey", jwt_secret);

const app = await init();
test("Test paidEvents up", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/paidEvents",
  });
  expect(response.statusCode).toBe(200);
  const responseDataJson = await response.json();
  expect(responseDataJson).toEqual({ Status: "Up" });
});

test("Test paidEvents get ticketEvents", async () => {
  ddbMock.on(ScanCommand).resolves({
    Items: dynamoTableData as any,
  });
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/paidEvents/ticketEvents",
  });
  expect(response.statusCode).toBe(200);
  const responseDataJson = await response.json();
  expect(responseDataJson).toEqual(dynamoTableDataUnmarshalled);
});

test("Test paidEvents get ticketEvents by id", async () => {
  ddbMock.on(QueryCommand).resolves({
    Items: dynamoTableData as any,
  });
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/paidEvents/ticketEvents/test_barcrawl",
  });
  expect(response.statusCode).toBe(200);
  const responseDataJson = await response.json();
  expect(responseDataJson).toEqual(dynamoTableDataUnmarshalled[0]); //[0] since unmarshalled gives an array
});

test("Test dynamodb error handling", async () => {
  ddbMock.onAnyCommand().rejects("Nope");
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/paidEvents/ticketEvents",
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

afterAll(async () => {
  await app.close();
  vi.useRealTimers();
});
beforeEach(() => {
  ddbMock.reset();
  vi.useFakeTimers();
});
