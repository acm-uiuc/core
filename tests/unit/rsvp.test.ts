import { expect, test, vi, describe, beforeEach } from "vitest";
import {
  DynamoDBClient,
  QueryCommand,
  TransactWriteItemsCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import init from "../../src/api/server.js";
import { createJwt } from "./auth.test.js";
import { secretObject } from "./secret.testdata.js";
import { Redis } from "../../src/api/types.js";
import { FastifyBaseLogger } from "fastify";
import { randomUUID } from "node:crypto";

const DUMMY_JWT = createJwt();
const DEFAULT_HEADERS = {
  "x-uiuc-token": DUMMY_JWT,
  "x-turnstile-response": "a", // needs to be one char
};

class TransactionError extends Error {
  name = "TransactionCanceledException";
  CancellationReasons: { Code: string }[];
  constructor(reasons: { Code: string }[]) {
    super("Transaction canceled");
    this.CancellationReasons = reasons;
  }
}

vi.mock("../../src/api/functions/uin.js", async () => {
  const actual = await vi.importActual("../../src/api/functions/uin.js");
  return {
    ...actual,
    verifyUiucAccessToken: vi
      .fn()
      .mockImplementation(
        async ({
          token,
          logger,
        }: {
          token: string;
          logger: FastifyBaseLogger;
        }) => {
          return {
            userPrincipalName: "jd3@illinois.edu",
            givenName: "John",
            surname: "Doe",
            mail: "johndoe@gmail.com",
          };
        },
      ),
  };
});

vi.mock("../../src/api/functions/membership.js", async () => {
  const actual = await vi.importActual("../../src/api/functions/membership.js");
  return {
    ...actual,
    checkPaidMembership: vi
      .fn()
      .mockImplementation(
        async ({
          netId,
          redisClient,
          dynamoClient,
          logger,
        }: {
          netId: string;
          redisClient: Redis;
          dynamoClient: DynamoDBClient;
          logger: FastifyBaseLogger;
        }) => {
          if (netId === "jd3") {
            return true;
          }
          return false;
        },
      ),
  };
});

const ddbMock = mockClient(DynamoDBClient);
const jwt_secret = secretObject["jwt_key"];
vi.stubEnv("JwtSigningKey", jwt_secret);

const app = await init();

describe("RSVP API tests", () => {
  beforeEach(() => {
    ddbMock.reset();
    vi.clearAllMocks();
  });

  test("Submitting RSVPs requires the turnstile token header", async () => {
    const eventId = randomUUID();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}`,
      headers: { "x-uiuc-token": DUMMY_JWT },
    });
    expect(response.statusCode).toBe(400);
    const data = JSON.parse(response.body);
    expect(data).toStrictEqual({
      error: true,
      name: "ValidationError",
      id: 104,
      message:
        "headers/x-turnstile-response Invalid input: expected string, received undefined",
    });
  });
  test("Submitting RSVPs runs turnstile token verification", async () => {
    const eventId = randomUUID();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}`,
      headers: { "x-uiuc-token": DUMMY_JWT, "x-turnstile-response": "invalid" }, // 3-char response requires hitting the function
    });
    expect(response.statusCode).toBe(400);
    const data = JSON.parse(response.body);
    expect(data).toStrictEqual({
      error: true,
      name: "ValidationError",
      id: 104,
      message: "Invalid Turnstile token.",
    });
  });

  test("Test posting an RSVP for an event", async () => {
    const eventId = "Make Your Own Database";

    ddbMock.on(GetItemCommand).resolves({
      Item: marshall({
        partitionKey: `CONFIG#${eventId}`,
        eventId,
        rsvpLimit: 100,
        rsvpOpenAt: Math.floor(Date.now() / 1000) - 10,
        rsvpCloseAt: Math.floor(Date.now() / 1000) + 10,
        rsvpCheckInEnabled: false,
      }),
    });

    ddbMock.on(TransactWriteItemsCommand).resolves({});

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}`,
      headers: DEFAULT_HEADERS,
    });

    expect(response.statusCode).toBe(201);
  });

  test("Test posting an RSVP fails if Config is missing", async () => {
    const eventId = "Closed Event";

    ddbMock.on(GetItemCommand).resolves({});

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}`,
      headers: DEFAULT_HEADERS,
    });

    expect(response.statusCode).toBe(404);
  });

  test("Test double RSVP (Conflict)", async () => {
    const eventId = "Make Your Own Database";

    ddbMock.on(GetItemCommand).resolves({
      Item: marshall({
        partitionKey: `CONFIG#${eventId}`,
        rsvpLimit: 100,
        rsvpCount: 10,
        rsvpOpenAt: Math.floor(Date.now() / 1000) - 10,
        rsvpCloseAt: Math.floor(Date.now() / 1000) + 10,
        rsvpCheckInEnabled: false,
      }),
    });

    const txError = new TransactionError([
      { Code: "ConditionalCheckFailed" },
      { Code: "None" },
    ]);
    ddbMock.on(TransactWriteItemsCommand).rejects(txError);

    const testJwt = createJwt();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}`,
      headers: DEFAULT_HEADERS,
    });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body);
    expect(body.message).toBe(
      "This user has already submitted an RSVP for this event.",
    );
  });

  test("Test posting RSVP when Event is Full (Limit Reached)", async () => {
    const eventId = "Popular Event";

    ddbMock.on(GetItemCommand).resolves({
      Item: marshall({
        partitionKey: `CONFIG#${eventId}`,
        rsvpLimit: 100,
        rsvpCount: 100,
        rsvpOpenAt: Math.floor(Date.now() / 1000) - 10,
        rsvpCloseAt: Math.floor(Date.now() / 1000) + 10,
        rsvpCheckInEnabled: false,
      }),
    });

    const txError = new TransactionError([
      { Code: "None" },
      { Code: "ConditionalCheckFailed" },
    ]);
    ddbMock.on(TransactWriteItemsCommand).rejects(txError);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}`,
      headers: DEFAULT_HEADERS,
    });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body);
    expect(body.message).toBe("RSVP limit has been reached for this event.");
  });

  test("Test getting my own RSVPs (Mocking Query Response)", async () => {
    const upn = "jd3@illinois.edu";
    const mockRsvps = [
      {
        partitionKey: `RSVP#EventA#${upn}`,
        eventId: "EventA",
        userId: upn,
        isPaidMember: true,
        createdAt: Math.floor(Date.now() / 1000),
      },
      {
        partitionKey: `RSVP#EventB#${upn}`,
        eventId: "EventB",
        userId: upn,
        isPaidMember: true,
        createdAt: Math.floor(Date.now() / 1000),
      },
    ];

    ddbMock.on(QueryCommand).resolves({
      Items: mockRsvps.map((item) => marshall(item)),
    });

    const testJwt = createJwt();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/rsvp/me`,
      headers: {
        Authorization: `Bearer ${testJwt}`,
        "x-uiuc-token": DUMMY_JWT,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveLength(2);
    expect(body[0].eventId).toBe("EventA");
    expect(body[1].eventId).toBe("EventB");
  });
  test("Test getting RSVPs for an event (Mocking Query Response)", async () => {
    const eventId = "Make Your Own Database";
    const mockRsvps = [
      {
        partitionKey: `RSVP#${eventId}#user1@illinois.edu`,
        eventId,
        userId: "user1@illinois.edu",
        isPaidMember: true,
        createdAt: Math.floor(Date.now() / 1000),
      },
      {
        partitionKey: `RSVP#${eventId}#user2@illinois.edu`,
        eventId,
        userId: "user2@illinois.edu",
        isPaidMember: false,
        createdAt: Math.floor(Date.now() / 1000),
      },
      {
        partitionKey: `CONFIG#${eventId}`,
        eventId,
        rsvpLimit: 100,
        rsvpCount: 50,
        rsvpOpenAt: Math.floor(Date.now() / 1000) - 10,
        rsvpCloseAt: Math.floor(Date.now() / 1000) + 10,
        rsvpCheckInEnabled: false,
      },
    ];

    ddbMock.on(QueryCommand).resolves({
      Items: mockRsvps.map((item) => marshall(item)),
    });

    const adminJwt = createJwt();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}`,
      headers: {
        Authorization: `Bearer ${adminJwt}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body).toHaveLength(2);
    expect(
      body.find((x: any) => x.userId === "user1@illinois.edu"),
    ).toBeDefined();
    expect(
      body.find((x: any) => x.userId === "user2@illinois.edu"),
    ).toBeDefined();
  });

  test("Test withdrawing own RSVP", async () => {
    ddbMock.on(TransactWriteItemsCommand).resolves({});

    const eventId = "Make Your Own Database";
    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}/attendee/me`,
      headers: DEFAULT_HEADERS,
    });

    expect(response.statusCode).toBe(204);
  });

  test("Test withdrawing own RSVP when not RSVP'd", async () => {
    const txError = new TransactionError([
      { Code: "ConditionalCheckFailed" },
      { Code: "None" },
    ]);
    ddbMock.on(TransactWriteItemsCommand).rejects(txError);

    const eventId = "Make Your Own Database";

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}/attendee/me`,
      headers: DEFAULT_HEADERS,
    });

    expect(response.statusCode).toBe(204);
  });

  test("Test Manager deleting a user's RSVP", async () => {
    ddbMock.on(TransactWriteItemsCommand).resolves({});

    const adminJwt = createJwt();
    const eventId = "Make Your Own Database";
    const targetUserId = "user1@illinois.edu";

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}/attendee/${encodeURIComponent(targetUserId)}`,
      headers: {
        Authorization: `Bearer ${adminJwt}`,
      },
    });

    expect(response.statusCode).toBe(204);
  });

  test("Test Manager deleting non-existent RSVP (Not Found)", async () => {
    const txError = new TransactionError([
      { Code: "ConditionalCheckFailed" },
      { Code: "None" },
    ]);
    ddbMock.on(TransactWriteItemsCommand).rejects(txError);

    const adminJwt = createJwt();
    const eventId = "Make Your Own Database";
    const targetUserId = "ghost@illinois.edu";

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}/attendee/${encodeURIComponent(targetUserId)}`,
      headers: {
        Authorization: `Bearer ${adminJwt}`,
      },
    });

    expect(response.statusCode).toBe(404);
  });

  test("Test Manager configuring rsvp limit", async () => {
    ddbMock.on(TransactWriteItemsCommand).resolves({});

    const adminJwt = createJwt();
    const eventId = "Make Your Own Database";
    const newLimit = 50;

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}/config`,
      headers: {
        Authorization: `Bearer ${adminJwt}`,
      },
      payload: {
        rsvpLimit: newLimit,
        rsvpCheckInEnabled: false,
        rsvpOpenAt: Math.floor(Date.now() / 1000),
        rsvpCloseAt: Math.floor(Date.now() / 1000) + 100,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(ddbMock.calls()).toHaveLength(1);
  });

  test("Test Manager getting RSVP configuration", async () => {
    const eventId = "Make Your Own Database";
    const mockConfig = {
      partitionKey: `CONFIG#${eventId}`,
      eventId,
      rsvpLimit: 50,
      rsvpCheckInEnabled: true,
      rsvpOpenAt: Math.floor(Date.now() / 1000) - 100,
      rsvpCloseAt: Math.floor(Date.now() / 1000) + 100,
    };

    ddbMock.on(GetItemCommand).resolves({
      Item: marshall(mockConfig),
    });

    const adminJwt = createJwt();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}/config`,
      headers: {
        Authorization: `Bearer ${adminJwt}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.rsvpLimit).toBe(50);
    expect(body.rsvpCheckInEnabled).toBe(true);
    expect(body.rsvpOpenAt).toBe(mockConfig.rsvpOpenAt);
    expect(body.rsvpCloseAt).toBe(mockConfig.rsvpCloseAt);
  });

  test("Test Manager configuring non-existent event (404)", async () => {
    const txError = new TransactionError([
      { Code: "ConditionalCheckFailed" },
      { Code: "None" },
    ]);
    ddbMock.on(TransactWriteItemsCommand).rejects(txError);

    const adminJwt = createJwt();
    const eventId = "GhostEvent";

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}/config`,
      headers: {
        Authorization: `Bearer ${adminJwt}`,
      },
      payload: {
        rsvpLimit: 100,
        rsvpCount: 10,
        rsvpOpenAt: Math.floor(Date.now() / 1000) - 10,
        rsvpCloseAt: Math.floor(Date.now() / 1000) + 10,
        rsvpCheckInEnabled: false,
      },
    });

    expect(response.statusCode).toBe(404);
  });

  test("Test manager getting non existent event config (500)", async () => {
    ddbMock.on(GetItemCommand).resolves({});

    const adminJwt = createJwt();
    const eventId = "GhostEvent";

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}/config`,
      headers: {
        Authorization: `Bearer ${adminJwt}`,
      },
    });

    expect(response.statusCode).toBe(500);
  });
});
