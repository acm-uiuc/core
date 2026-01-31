import { expect, test, vi, describe, beforeEach } from "vitest";
import {
  DynamoDBClient,
  QueryCommand,
  TransactWriteItemsCommand,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
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

const MOCK_UPN = "jd3@illinois.edu";

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
            userPrincipalName: MOCK_UPN,
            givenName: "John",
            surname: "Doe",
            mail: "johndoe@gmail.com",
            netId: "jd3",
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

const setupMockProfile = (exists = true) => {
  if (!exists) {
    ddbMock
      .on(GetItemCommand, {
        Key: marshall({ partitionKey: `PROFILE#${MOCK_UPN}` }),
      })
      .resolves({});
    return;
  }
  ddbMock
    .on(GetItemCommand, {
      Key: marshall({ partitionKey: `PROFILE#${MOCK_UPN}` }),
    })
    .resolves({
      Item: marshall({
        partitionKey: `PROFILE#${MOCK_UPN}`,
        userId: MOCK_UPN,
        schoolYear: "Junior",
        intendedMajor: "Computer Science",
        interests: ["AI"],
        dietaryRestrictions: ["None"],
        updatedAt: 12345,
      }),
    });
};

describe("RSVP API tests", () => {
  beforeEach(() => {
    ddbMock.reset();
    vi.clearAllMocks();
  });

  test("POST /profile - Create/Update Profile successfully", async () => {
    ddbMock.on(PutItemCommand).resolves({});

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/rsvp/profile",
      headers: DEFAULT_HEADERS,
      payload: {
        schoolYear: "Senior",
        intendedMajor: "Computer Science",
        interests: ["Systems", "Security"],
        dietaryRestrictions: ["Vegan"],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(ddbMock.calls()).toHaveLength(1); // 1 PutItem
  });

  test("GET /profile/me - Retrieve Profile", async () => {
    setupMockProfile(true);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/rsvp/profile/me",
      headers: DEFAULT_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.schoolYear).toBe("Junior");
    expect(body.intendedMajor).toBe("Computer Science");
  });

  test("GET /profile/me - Not Found", async () => {
    setupMockProfile(false);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/rsvp/profile/me",
      headers: DEFAULT_HEADERS,
    });

    expect(response.statusCode).toBe(404);
  });

  test("DELETE /profile/me - Delete Profile", async () => {
    ddbMock.on(DeleteItemCommand).resolves({});

    const response = await app.inject({
      method: "DELETE",
      url: "/api/v1/rsvp/profile/me",
      headers: DEFAULT_HEADERS,
    });

    expect(response.statusCode).toBe(200);
  });

  test("Submitting RSVPs requires the turnstile token header", async () => {
    const eventId = randomUUID();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}`,
      headers: { "x-uiuc-token": DUMMY_JWT },
    });
    expect(response.statusCode).toBe(400);
  });

  test("Test posting an RSVP (Success with Profile)", async () => {
    const eventId = "Make Your Own Database";

    ddbMock
      .on(GetItemCommand, {
        Key: marshall({ partitionKey: `CONFIG#${eventId}` }),
      })
      .resolves({
        Item: marshall({
          partitionKey: `CONFIG#${eventId}`,
          eventId,
          rsvpLimit: 100,
          rsvpOpenAt: Math.floor(Date.now() / 1000) - 10,
          rsvpCloseAt: Math.floor(Date.now() / 1000) + 10,
          rsvpCheckInEnabled: false,
        }),
      });
    setupMockProfile(true);

    ddbMock.on(TransactWriteItemsCommand).resolves({});

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}`,
      headers: DEFAULT_HEADERS,
    });

    expect(response.statusCode).toBe(201);
  });

  test("Test posting an RSVP FAILS if Profile is missing", async () => {
    const eventId = "Make Your Own Database";

    ddbMock
      .on(GetItemCommand, {
        Key: marshall({ partitionKey: `CONFIG#${eventId}` }),
      })
      .resolves({
        Item: marshall({
          partitionKey: `CONFIG#${eventId}`,
          rsvpLimit: 100,
          rsvpOpenAt: Math.floor(Date.now() / 1000) - 10,
          rsvpCloseAt: Math.floor(Date.now() / 1000) + 10,
        }),
      });
    setupMockProfile(false);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}`,
      headers: DEFAULT_HEADERS,
    });

    // Expecting 400 Bad Request because profile is required logic
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toBe("Profile Required");
  });

  test("Test posting an RSVP fails if Event Config is missing", async () => {
    const eventId = "Closed Event";

    // Only config fetch happens first, fails, so profile fetch might happen concurrently but config failure throws first
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
    setupMockProfile(true);

    ddbMock
      .on(GetItemCommand, {
        Key: marshall({ partitionKey: `CONFIG#${eventId}` }),
      })
      .resolves({
        Item: marshall({
          partitionKey: `CONFIG#${eventId}`,
          rsvpLimit: 100,
          rsvpCount: 10,
          rsvpOpenAt: Math.floor(Date.now() / 1000) - 10,
          rsvpCloseAt: Math.floor(Date.now() / 1000) + 10,
        }),
      });

    const txError = new TransactionError([
      { Code: "ConditionalCheckFailed" },
      { Code: "None" },
    ]);
    ddbMock.on(TransactWriteItemsCommand).rejects(txError);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}`,
      headers: DEFAULT_HEADERS,
    });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body);
    expect(body.message).toBe("You have already RSVP'd for this event.");
  });

  test("Test posting RSVP when Event is Full (Limit Reached)", async () => {
    const eventId = "Popular Event";
    setupMockProfile(true);

    ddbMock
      .on(GetItemCommand, {
        Key: marshall({ partitionKey: `CONFIG#${eventId}` }),
      })
      .resolves({
        Item: marshall({
          partitionKey: `CONFIG#${eventId}`,
          rsvpLimit: 100,
          rsvpCount: 100,
          rsvpOpenAt: Math.floor(Date.now() / 1000) - 10,
          rsvpCloseAt: Math.floor(Date.now() / 1000) + 10,
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
    expect(body.message).toBe("RSVP limit has been reached.");
  });

  // -------------------------------------------------------------------------
  // Existing Management/Get Tests (Unchanged logic, just ensure mocks work)
  // -------------------------------------------------------------------------

  test("Test getting my own RSVPs", async () => {
    const upn = MOCK_UPN;
    // FIX: Included ALL fields required by rsvpItemSchema to prevent 500 error
    const mockRsvps = [
      {
        partitionKey: `RSVP#EventA#${upn}`,
        eventId: "EventA",
        userId: upn,
        isPaidMember: true,
        checkedIn: false,
        schoolYear: "Junior",
        intendedMajor: "CS",
        interests: [],
        dietaryRestrictions: [],
        createdAt: Math.floor(Date.now() / 1000),
      },
    ];

    ddbMock.on(QueryCommand).resolves({
      Items: mockRsvps.map((item) => marshall(item)),
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/rsvp/me`,
      headers: DEFAULT_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveLength(1);
    expect(body[0].eventId).toBe("EventA");
  });

  test("Test getting RSVPs for an event", async () => {
    const eventId = "EventA";
    // FIX: Included ALL fields required by rsvpItemSchema to prevent 500 error
    const mockRsvps = [
      {
        partitionKey: `RSVP#${eventId}#user1@illinois.edu`,
        eventId,
        userId: "user1@illinois.edu",
        isPaidMember: true,
        checkedIn: true,
        schoolYear: "Senior",
        intendedMajor: "CS",
        interests: ["Systems"],
        dietaryRestrictions: ["None"],
        createdAt: Math.floor(Date.now() / 1000),
      },
    ];

    ddbMock.on(QueryCommand).resolves({
      Items: mockRsvps.map((item) => marshall(item)),
    });

    const adminJwt = createJwt();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/rsvp/event/${eventId}`,
      headers: { Authorization: `Bearer ${adminJwt}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveLength(1);
    expect(body[0].userId).toBe("user1@illinois.edu");
    expect(body[0].checkedIn).toBe(true);
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
  });
});
