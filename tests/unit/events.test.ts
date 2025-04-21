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
vi.mock("../../src/api/functions/discord.js", async () => {
  return {
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

  const testJwt = createJwt(undefined, ["0"]);

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

test("Should return 304 Not Modified when If-None-Match header matches ETag", async () => {
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

  const testJwt = createJwt(undefined, ["0"]);

  // 1. First GET request to establish ETag
  const initialResponse = await app.inject({
    method: "GET",
    url: "/api/v1/events",
    headers: {
      Authorization: `Bearer ${testJwt}`,
    },
  });

  expect(initialResponse.statusCode).toBe(200);
  expect(initialResponse.headers.etag).toBe("0");

  // 2. Second GET request with If-None-Match header matching the ETag
  const conditionalResponse = await app.inject({
    method: "GET",
    url: "/api/v1/events",
    headers: {
      Authorization: `Bearer ${testJwt}`,
      "If-None-Match": "0",
    },
  });

  // Expect 304 Not Modified
  expect(conditionalResponse.statusCode).toBe(304);
  expect(conditionalResponse.headers.etag).toBe("0");
  expect(conditionalResponse.body).toBe(""); // Empty body on 304
});

test("Should return 304 Not Modified when If-None-Match header matches quoted ETag", async () => {
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

  const testJwt = createJwt(undefined, ["0"]);

  // 1. First GET request to establish ETag
  const initialResponse = await app.inject({
    method: "GET",
    url: "/api/v1/events",
    headers: {
      Authorization: `Bearer ${testJwt}`,
    },
  });

  expect(initialResponse.statusCode).toBe(200);
  expect(initialResponse.headers.etag).toBe("0");

  // 2. Second GET request with quoted If-None-Match header
  const conditionalResponse = await app.inject({
    method: "GET",
    url: "/api/v1/events",
    headers: {
      Authorization: `Bearer ${testJwt}`,
      "If-None-Match": '"0"',
    },
  });

  // Expect 304 Not Modified
  expect(conditionalResponse.statusCode).toBe(304);
  expect(conditionalResponse.headers.etag).toBe("0");
  expect(conditionalResponse.body).toBe(""); // Empty body on 304
});

test("Should NOT return 304 when ETag has changed", async () => {
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

  const testJwt = createJwt(undefined, ["0"]);

  // 1. Initial GET to establish ETag
  const initialResponse = await app.inject({
    method: "GET",
    url: "/api/v1/events",
    headers: {
      Authorization: `Bearer ${testJwt}`,
    },
  });

  expect(initialResponse.statusCode).toBe(200);
  expect(initialResponse.headers.etag).toBe("0");

  // 2. Create a new event to change the ETag
  const eventResponse = await supertest(app.server)
    .post("/api/v1/events")
    .set("Authorization", `Bearer ${testJwt}`)
    .send({
      description: "Test event to change ETag",
      host: "Social Committee",
      location: "Siebel Center",
      start: "2024-09-25T18:00:00",
      title: "ETag Change Test",
      featured: false,
    });

  expect(eventResponse.statusCode).toBe(201);
  const eventId = eventResponse.body.id;

  // Mock GetItemCommand to return the event we just created
  ddbMock.on(GetItemCommand).resolves({
    Item: marshall({
      id: eventId,
      title: "ETag Change Test",
      description: "Test event to change ETag",
      host: "Social Committee",
      location: "Siebel Center",
      start: "2024-09-25T18:00:00",
      featured: false,
    }),
  });

  // 3. Make conditional request with old ETag
  const conditionalResponse = await app.inject({
    method: "GET",
    url: "/api/v1/events",
    headers: {
      Authorization: `Bearer ${testJwt}`,
      "If-None-Match": "0",
    },
  });

  // Expect 200 OK (not 304) since ETag has changed
  expect(conditionalResponse.statusCode).toBe(200);
  expect(conditionalResponse.headers.etag).toBe("1");
  expect(conditionalResponse.body).not.toBe(""); // Should have body content
});

test("Should handle 304 responses for individual event endpoints", async () => {
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

  // Create an event
  const testJwt = createJwt(undefined, ["0"]);
  const eventResponse = await supertest(app.server)
    .post("/api/v1/events")
    .set("Authorization", `Bearer ${testJwt}`)
    .send({
      description: "Individual event test",
      host: "Social Committee",
      location: "Siebel Center",
      start: "2024-09-25T18:00:00",
      title: "ETag Individual Test",
      featured: false,
    });

  expect(eventResponse.statusCode).toBe(201);
  const eventId = eventResponse.body.id;

  // Mock GetItemCommand to return the event
  ddbMock.on(GetItemCommand).resolves({
    Item: marshall({
      id: eventId,
      title: "ETag Individual Test",
      description: "Individual event test",
      host: "Social Committee",
      location: "Siebel Center",
      start: "2024-09-25T18:00:00",
      featured: false,
    }),
  });

  // 1. First GET to establish ETag
  const initialEventResponse = await app.inject({
    method: "GET",
    url: `/api/v1/events/${eventId}`,
    headers: {
      Authorization: `Bearer ${testJwt}`,
    },
  });

  expect(initialEventResponse.statusCode).toBe(200);
  expect(initialEventResponse.headers.etag).toBe("1");

  // 2. Second GET with matching If-None-Match
  const conditionalEventResponse = await app.inject({
    method: "GET",
    url: `/api/v1/events/${eventId}`,
    headers: {
      Authorization: `Bearer ${testJwt}`,
      "If-None-Match": "1",
    },
  });

  // Expect 304 Not Modified
  expect(conditionalEventResponse.statusCode).toBe(304);
  expect(conditionalEventResponse.headers.etag).toBe("1");
  expect(conditionalEventResponse.body).toBe("");
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
