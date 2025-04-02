import { afterAll, expect, test, beforeEach, vi, describe } from "vitest";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
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

const app = await init();

vi.mock("../../src/api/functions/discord.js", () => {
  const updateDiscordMock = vi.fn().mockResolvedValue({});
  return {
    updateDiscord: updateDiscordMock,
  };
});

test("Sad path: Not authenticated", async () => {
  await app.ready();
  const response = await supertest(app.server).post("/api/v1/events").send({
    description: "Test paid event.",
    end: "2024-09-25T19:00:00",
    featured: true,
    host: "Social Committee",
    location: "Illini Union",
    start: "2024-09-25T18:00:00",
    title: "Fall Semiformal",
    paidEventId: "sp24_semiformal",
  });

  expect(response.statusCode).toBe(403);
});

test("Sad path: Authenticated but not authorized", async () => {
  await app.ready();
  const testJwt = createJwt(undefined, "1");
  const response = await supertest(app.server)
    .post("/api/v1/events")
    .set("Authorization", `Bearer ${testJwt}`)
    .send({
      description: "Test paid event.",
      end: "2024-09-25T19:00:00",
      featured: true,
      host: "Social Committee",
      location: "Illini Union",
      start: "2024-09-25T18:00:00",
      title: "Fall Semiformal",
      paidEventId: "sp24_semiformal",
    });
  expect(response.statusCode).toBe(401);
});
test("Sad path: Prevent empty body request", async () => {
  await app.ready();
  const testJwt = createJwt(undefined, "0");
  const response = await supertest(app.server)
    .post("/api/v1/events")
    .set("Authorization", `Bearer ${testJwt}`)
    .send();
  expect(response.statusCode).toBe(400);
  expect(response.body).toStrictEqual({
    error: true,
    name: "ValidationError",
    id: 104,
    message: `Required at "title"; Required at "description"; Required at "start"; Required at "location"; Required at "host"`,
  });
});
test("Sad path: Prevent specifying repeatEnds on non-repeating events", async () => {
  ddbMock.on(PutItemCommand).resolves({});
  smMock.on(GetSecretValueCommand).resolves({
    SecretString: secretJson,
  });
  const testJwt = createJwt();
  await app.ready();
  const response = await supertest(app.server)
    .post("/api/v1/events")
    .set("authorization", `Bearer ${testJwt}`)
    .send({
      description: "Test paid event.",
      end: "2024-09-25T19:00:00",
      featured: false,
      host: "Social Committee",
      location: "Illini Union",
      start: "2024-09-25T18:00:00",
      title: "Fall Semiformal",
      repeatEnds: "2024-09-25T18:00:00",
      paidEventId: "sp24_semiformal",
    });

  expect(response.statusCode).toBe(400);
  expect(response.body).toStrictEqual({
    error: true,
    name: "ValidationError",
    id: 104,
    message: "repeats is required when repeatEnds is defined",
  });
});

test("Sad path: Prevent specifying unknown repeat frequencies", async () => {
  ddbMock.on(PutItemCommand).resolves({});
  smMock.on(GetSecretValueCommand).resolves({
    SecretString: secretJson,
  });
  const testJwt = createJwt();
  await app.ready();
  const response = await supertest(app.server)
    .post("/api/v1/events")
    .set("authorization", `Bearer ${testJwt}`)
    .send({
      description: "Test paid event.",
      end: "2024-09-25T19:00:00",
      featured: false,
      host: "Social Committee",
      location: "Illini Union",
      start: "2024-09-25T18:00:00",
      title: "Fall Semiformal",
      repeats: "forever_and_ever",
      paidEventId: "sp24_semiformal",
    });

  expect(response.statusCode).toBe(400);
  expect(response.body).toStrictEqual({
    error: true,
    name: "ValidationError",
    id: 104,
    message: `Invalid enum value. Expected 'weekly' | 'biweekly', received 'forever_and_ever' at "repeats"`,
  });
});

test("Happy path: Adding a non-repeating, featured, paid event", async () => {
  ddbMock.on(PutItemCommand).resolves({});
  smMock.on(GetSecretValueCommand).resolves({
    SecretString: secretJson,
  });
  const testJwt = createJwt();
  await app.ready();
  const response = await supertest(app.server)
    .post("/api/v1/events")
    .set("authorization", `Bearer ${testJwt}`)
    .send({
      description: "Test paid event.",
      end: "2024-09-25T19:00:00",
      featured: true,
      host: "Social Committee",
      location: "Illini Union",
      locationLink: "https://maps.app.goo.gl/rUBhjze5mWuTSUJK9",
      start: "2024-09-25T18:00:00",
      title: "Fall Semiformal",
      paidEventId: "sp24_semiformal",
    });

  expect(response.statusCode).toBe(201);
  const responseDataJson = response.body as { id: string; resource: string };
  expect(responseDataJson).toHaveProperty("id");
  const uuid = responseDataJson["id"];
  expect(responseDataJson).toEqual({
    id: uuid,
    resource: `/api/v1/events/${uuid}`,
  });
});

test("Happy path: Adding a weekly repeating, non-featured, paid event", async () => {
  ddbMock.on(PutItemCommand).resolves({});
  smMock.on(GetSecretValueCommand).resolves({
    SecretString: secretJson,
  });
  const testJwt = createJwt();
  await app.ready();
  const response = await supertest(app.server)
    .post("/api/v1/events")
    .set("authorization", `Bearer ${testJwt}`)
    .send({
      description: "Test paid event.",
      end: "2024-09-25T19:00:00",
      featured: false,
      host: "Social Committee",
      location: "Illini Union",
      start: "2024-09-25T18:00:00",
      title: "Fall Semiformal",
      repeats: "weekly",
      paidEventId: "sp24_semiformal",
    });

  expect(response.statusCode).toBe(201);
  const responseDataJson = response.body as { id: string; resource: string };
  expect(responseDataJson).toHaveProperty("id");
  const uuid = responseDataJson["id"];
  expect(responseDataJson).toEqual({
    id: uuid,
    resource: `/api/v1/events/${uuid}`,
  });
});

describe("ETag Lifecycle Tests", () => {
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

  test("ETags should be deleted when events are deleted", async () => {
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
    ddbMock.on(ScanCommand).resolves({
      Items: [],
    });

    const testJwt = createJwt(undefined, "0");

    // 1. Create an event
    const eventResponse = await supertest(app.server)
      .post("/api/v1/events")
      .set("Authorization", `Bearer ${testJwt}`)
      .send({
        description: "Test event for deletion",
        host: "Social Committee",
        location: "Siebel Center",
        start: "2024-09-25T18:00:00",
        title: "Event to delete",
        featured: false,
      });

    expect(eventResponse.statusCode).toBe(201);
    const eventId = eventResponse.body.id;

    // Mock GetItemCommand to return the event
    ddbMock.on(GetItemCommand).resolves({
      Item: marshall({
        id: eventId,
        title: "Event to delete",
        description: "Test event for deletion",
        host: "Social Committee",
        location: "Siebel Center",
        start: "2024-09-25T18:00:00",
        featured: false,
      }),
    });

    // 2. Verify the event's etag exists (should be 1)
    const eventBeforeDelete = await app.inject({
      method: "GET",
      url: `/api/v1/events/${eventId}`,
      headers: {
        Authorization: `Bearer ${testJwt}`,
      },
    });

    expect(eventBeforeDelete.statusCode).toBe(200);
    expect(eventBeforeDelete.headers.etag).toBe("1");

    // 3. Delete the event
    const deleteResponse = await supertest(app.server)
      .delete(`/api/v1/events/${eventId}`)
      .set("Authorization", `Bearer ${testJwt}`);

    expect(deleteResponse.statusCode).toBe(201);

    // 4. Verify the event no longer exists (should return 404)
    // Change the mock to return empty response (simulating deleted event)
    ddbMock.on(GetItemCommand).resolves({
      Item: undefined,
    });

    const eventAfterDelete = await app.inject({
      method: "GET",
      url: `/api/v1/events/${eventId}`,
      headers: {
        Authorization: `Bearer ${testJwt}`,
      },
    });

    expect(eventAfterDelete.statusCode).toBe(404);

    // 5. Check that all-events etag is incremented to 2
    // (1 for creation, 2 for deletion)
    const allEventsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: {
        Authorization: `Bearer ${testJwt}`,
      },
    });

    expect(allEventsResponse.statusCode).toBe(200);
    expect(allEventsResponse.headers.etag).toBe("2");
  });

  test("ETags for different events should be independent", async () => {
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

    // Mock ScanCommand to return empty Items array initially
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

    // 2. Create first event
    const event1Response = await supertest(app.server)
      .post("/api/v1/events")
      .set("Authorization", `Bearer ${testJwt}`)
      .send({
        description: "First test event",
        host: "Social Committee",
        location: "Siebel Center",
        start: "2024-09-25T18:00:00",
        title: "Event 1",
        featured: false,
      });

    expect(event1Response.statusCode).toBe(201);
    const event1Id = event1Response.body.id;

    // 3. Create second event
    const event2Response = await supertest(app.server)
      .post("/api/v1/events")
      .set("Authorization", `Bearer ${testJwt}`)
      .send({
        description: "Second test event",
        host: "Infrastructure Committee",
        location: "ECEB",
        start: "2024-09-26T18:00:00",
        title: "Event 2",
        featured: false,
      });

    expect(event2Response.statusCode).toBe(201);
    const event2Id = event2Response.body.id;

    // Update GetItemCommand mock to handle different events
    ddbMock.on(GetItemCommand).callsFake((params) => {
      if (params.Key && params.Key.id) {
        const eventId = params.Key.id.S;

        if (eventId === event1Id) {
          return Promise.resolve({
            Item: marshall({
              id: event1Id,
              title: "Event 1",
              description: "First test event",
              host: "Social Committee",
              location: "Siebel Center",
              start: "2024-09-25T18:00:00",
              featured: false,
            }),
          });
        } else if (eventId === event2Id) {
          return Promise.resolve({
            Item: marshall({
              id: event2Id,
              title: "Event 2",
              description: "Second test event",
              host: "Infrastructure Committee",
              location: "ECEB",
              start: "2024-09-26T18:00:00",
              featured: false,
            }),
          });
        }
      }

      return Promise.resolve({});
    });

    // 4. Check that all events etag is now 2 (incremented twice)
    const allEventsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: {
        Authorization: `Bearer ${testJwt}`,
      },
    });

    expect(allEventsResponse.statusCode).toBe(200);
    expect(allEventsResponse.headers.etag).toBe("2");

    // 5. Check first event etag is 1
    const event1Response2 = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event1Id}`,
      headers: {
        Authorization: `Bearer ${testJwt}`,
      },
    });

    expect(event1Response2.statusCode).toBe(200);
    expect(event1Response2.headers.etag).toBe("1");

    // 6. Check second event etag is also 1
    const event2Response2 = await app.inject({
      method: "GET",
      url: `/api/v1/events/${event2Id}`,
      headers: {
        Authorization: `Bearer ${testJwt}`,
      },
    });

    expect(event2Response2.statusCode).toBe(200);
    expect(event2Response2.headers.etag).toBe("1");
  });
});

afterAll(async () => {
  await app.close();
  vi.useRealTimers();
});
beforeEach(() => {
  (app as any).nodeCache.flushAll();
  ddbMock.reset();
  smMock.reset();
  vi.clearAllMocks();
  vi.useFakeTimers();
});
