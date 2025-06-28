import { afterAll, expect, test, beforeEach, vi } from "vitest";
import { ScanCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import init from "../../src/api/index.js";
import {
  dynamoEventWithRepeatExclusion,
  dynamoTableData,
} from "./mockEventData.testdata.js";
import { testSecretObject } from "./secret.testdata.js";
import { readFile } from "fs/promises";

const ddbMock = mockClient(DynamoDBClient);
const jwt_secret = testSecretObject["jwt_key"];
vi.stubEnv("JwtSigningKey", jwt_secret);

const app = await init();
test("Test getting ACM-wide iCal calendar", async () => {
  const date = new Date(2024, 7, 22, 15, 51, 48); // August 22, 2024, at 15:51:48 (3:51:48 PM)
  vi.setSystemTime(date);
  ddbMock.on(ScanCommand).resolves({
    Items: dynamoTableData as any,
  });
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/ical",
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers["content-disposition"]).toEqual(
    'attachment; filename="calendar.ics"',
  );
  expect(response.body).toEqual(
    (await readFile("./tests/unit/data/acmWideCalendar.ics")).toString(),
  );
});

test("Test getting ACM-wide iCal calendar with specific repeat exclusion", async () => {
  const date = new Date(2024, 7, 22, 15, 51, 48); // August 22, 2024, at 15:51:48 (3:51:48 PM)
  vi.setSystemTime(date);
  ddbMock.on(ScanCommand).resolves({
    Items: [...dynamoTableData, dynamoEventWithRepeatExclusion] as any,
  });
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/ical",
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers["content-disposition"]).toEqual(
    'attachment; filename="calendar.ics"',
  );
  expect(response.body).toEqual(
    (
      await readFile("./tests/unit/data/acmWideCalendarRepeatExclude.ics")
    ).toString(),
  );
});

test("Test getting non-existent iCal calendar fails", async () => {
  const date = new Date(2024, 7, 22, 15, 51, 48); // August 22, 2024, at 15:51:48 (3:51:48 PM)
  vi.setSystemTime(date);
  ddbMock.on(ScanCommand).rejects();
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/ical/invalid",
  });
  expect(response.statusCode).toBe(400);
});

afterAll(async () => {
  await app.close();
  vi.useRealTimers();
});
beforeEach(() => {
  ddbMock.reset();
  vi.useFakeTimers();
});
