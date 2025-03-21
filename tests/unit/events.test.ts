import { afterAll, expect, test, beforeEach, vi } from "vitest";
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import init from "../../src/api/index.js";
import { createJwt } from "./auth.test.js";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { secretJson, secretObject } from "./secret.testdata.js";
import supertest from "supertest";
import { marshall } from "@aws-sdk/util-dynamodb";

const ddbMock = mockClient(DynamoDBClient);
const smMock = mockClient(SecretsManagerClient);
const jwt_secret = secretObject["jwt_key"];
vi.stubEnv("JwtSigningKey", jwt_secret);

// Mock the Discord client to prevent the actual Discord API call
vi.mock("../../src/api/functions/discord.js", async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    updateDiscord: vi.fn().mockResolvedValue({}),
  };
});

const app = await init();

test("ETag should increment after event creation", async () => {
  // Setup
  (app as any).nodeCache.flushAll();
  ddbMock.reset();
  smMock.reset();
  vi.useFakeTimers();

  // Mock secrets manager
  smMock.on(GetSecretValueCommand).resolves({
    SecretString: secretJson,
  });

  // Mock successful DynamoDB operations
  ddbMock.on(PutItemCommand).resolves({});

  // Mock ScanCommand to return empty Items array
  ddbMock.on(ScanCommand).resolves({
    Items: [],
  });

  const testJwt = createJwt(undefined, "0");

  // 1. Check initial etag for all events is 0
  const initialAllResponse = await app.inject({
    method: "GET",
    url: "/api/v1/events",
    headers: {
      Authorization: `Bearer ${testJwt}`,
    },
  });

  expect(initialAllResponse.statusCode).toBe(200);
  expect(initialAllResponse.headers.etag).toBe("0");

  // 2. Create a new event using supertest
  const eventResponse = await supertest(app.server)
    .post("/api/v1/events")
    .set("Authorization", `Bearer ${testJwt}`)
    .send({
      description: "Test event for ETag verification",
      host: "Social Committee",
      location: "Siebel Center",
      start: "2024-09-25T18:00:00",
      title: "ETag Test Event",
      featured: false,
    });

  expect(eventResponse.statusCode).toBe(201);
  const eventId = eventResponse.body.id;

  // Mock GetItemCommand to return the event we just created
  ddbMock.on(GetItemCommand).resolves({
    Item: marshall({
      id: eventId,
      title: "ETag Test Event",
      description: "Test event for ETag verification",
      host: "Social Committee",
      location: "Siebel Center",
      start: "2024-09-25T18:00:00",
      featured: false,
    }),
  });

  // 3. Check that the all events etag is now 1
  const allEventsResponse = await app.inject({
    method: "GET",
    url: "/api/v1/events",
    headers: {
      Authorization: `Bearer ${testJwt}`,
    },
  });

  expect(allEventsResponse.statusCode).toBe(200);
  expect(allEventsResponse.headers.etag).toBe("1");

  // 4. Check that the specific event etag is also 1
  const specificEventResponse = await app.inject({
    method: "GET",
    url: `/api/v1/events/${eventId}`,
    headers: {
      Authorization: `Bearer ${testJwt}`,
    },
  });

  expect(specificEventResponse.statusCode).toBe(200);
  expect(specificEventResponse.headers.etag).toBe("1");
});

afterAll(async () => {
  await app.close();
  vi.useRealTimers();
});

beforeEach(() => {
  (app as any).nodeCache.flushAll();
  ddbMock.reset();
  smMock.reset();
  vi.useFakeTimers();
});
