import { expect, test, vi, describe, beforeEach } from "vitest";
import {
  DynamoDBClient,
  QueryCommand,
  TransactWriteItemsCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import init from "../../src/api/server.js";
import { createJwt } from "./auth.test.js";
import { secretObject } from "./secret.testdata.js";
import { Redis } from "../../src/api/types.js";
import { FastifyBaseLogger } from "fastify";

const DUMMY_JWT = createJwt();

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

  test("Test posting an RSVP for an event", async () => {
    ddbMock.on(TransactWriteItemsCommand).resolves({});

    const testJwt = createJwt();
    const eventId = "Make Your Own Database";

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}`,
      headers: {
        Authorization: `Bearer ${testJwt}`,
        "x-uiuc-token": DUMMY_JWT,
      },
    });

    expect(response.statusCode).toBe(201);

    expect(ddbMock.calls()).toHaveLength(1);
    const transactInput = ddbMock.call(0).args[0].input as any;
    expect(transactInput.TransactItems[0].Put.TableName).toBe(
      "infra-core-api-events-rsvp",
    );
  });

  test("Test double RSVP (Conflict)", async () => {
    const err = new Error("TransactionCanceledException");
    err.name = "TransactionCanceledException";
    // @ts-ignore
    err.CancellationReasons = [
      { Code: "ConditionalCheckFailed" },
      { Code: "None" },
    ];
    ddbMock.on(TransactWriteItemsCommand).rejects(err);

    const testJwt = createJwt();
    const eventId = "Make Your Own Database";

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}`,
      headers: {
        Authorization: `Bearer ${testJwt}`,
        "x-uiuc-token": DUMMY_JWT,
      },
    });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body);
    expect(body.message).toBe(
      "This user has already submitted an RSVP for this event.",
    );
  });

  test("Test posting RSVP when Event is Full (Limit Reached)", async () => {
    const err = new Error("TransactionCanceledException");
    err.name = "TransactionCanceledException";
    // @ts-ignore
    err.CancellationReasons = [
      { Code: "None" },
      { Code: "ConditionalCheckFailed" },
    ];
    ddbMock.on(TransactWriteItemsCommand).rejects(err);

    const testJwt = createJwt();
    const eventId = "Popular Event";

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}`,
      headers: {
        Authorization: `Bearer ${testJwt}`,
        "x-uiuc-token": DUMMY_JWT,
      },
    });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body);
    expect(body.message).toBe("The event is at capacity.");
  });

  test("Test posting RSVP when Event is Full AND User already RSVP'd (Race Condition)", async () => {
    const err = new Error("TransactionCanceledException");
    err.name = "TransactionCanceledException";
    // @ts-ignore
    err.CancellationReasons = [
      { Code: "ConditionalCheckFailed" },
      { Code: "ConditionalCheckFailed" },
    ];
    ddbMock.on(TransactWriteItemsCommand).rejects(err);

    const testJwt = createJwt();
    const eventId = "Popular Event";

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}`,
      headers: {
        Authorization: `Bearer ${testJwt}`,
        "x-uiuc-token": DUMMY_JWT,
      },
    });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body);
    expect(body.message).toBe(
      "This user has already submitted an RSVP for this event.",
    );
  });

  test("Test getting RSVPs for an event (Mocking Query Response)", async () => {
    const eventId = "Make Your Own Database";
    const mockRsvps = [
      {
        partitionKey: `${eventId}#user1@illinois.edu`,
        eventId,
        userId: "user1@illinois.edu",
        isPaidMember: true,
        createdAt: Date.now(),
      },
      {
        partitionKey: `${eventId}#user2@illinois.edu`,
        eventId,
        userId: "user2@illinois.edu",
        isPaidMember: false,
        createdAt: Date.now(),
      },
    ];

    ddbMock.on(QueryCommand).resolves({
      Items: mockRsvps.map((item) => marshall(item)),
    });

    const adminJwt = await createJwt();

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
    expect(body[0].userId).toBe("user1@illinois.edu");
    expect(body[1].userId).toBe("user2@illinois.edu");
  });
  test("Test withdrawing own RSVP", async () => {
    ddbMock.on(TransactWriteItemsCommand).resolves({});

    const testJwt = createJwt();
    const eventId = "Make Your Own Database";

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}/attendee/me`,
      headers: {
        Authorization: `Bearer ${testJwt}`,
        "x-uiuc-token": DUMMY_JWT,
      },
    });

    expect(response.statusCode).toBe(204);
    expect(ddbMock.calls()).toHaveLength(1);
  });

  test("Test withdrawing own RSVP when not RSVP'd", async () => {
    const err = new Error("TransactionCanceledException");
    err.name = "TransactionCanceledException";
    // @ts-ignore
    err.CancellationReasons = [
      { Code: "ConditionalCheckFailed" }, // Delete failed because item didn't exist
      { Code: "None" },
    ];
    ddbMock.on(TransactWriteItemsCommand).rejects(err);

    const testJwt = createJwt();
    const eventId = "Make Your Own Database";

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}/attendee/me`,
      headers: {
        Authorization: `Bearer ${testJwt}`,
        "x-uiuc-token": DUMMY_JWT,
      },
    });

    // Should still return 204 because the goal (not being RSVP'd) is achieved
    expect(response.statusCode).toBe(204);
  });

  test("Test withdrawing own RSVP when rsvpCount is already 0 (Safety Check)", async () => {
    const err = new Error("TransactionCanceledException");
    err.name = "TransactionCanceledException";
    // @ts-ignore
    err.CancellationReasons = [
      { Code: "None" },
      { Code: "ConditionalCheckFailed" },
    ];
    ddbMock.on(TransactWriteItemsCommand).rejects(err);

    const testJwt = createJwt();
    const eventId = "Make Your Own Database";

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}/attendee/me`,
      headers: {
        Authorization: `Bearer ${testJwt}`,
        "x-uiuc-token": DUMMY_JWT,
      },
    });

    expect(response.statusCode).toBe(500);
  });

  test("Test Manager deleting a user's RSVP", async () => {
    ddbMock.on(TransactWriteItemsCommand).resolves({});

    const adminJwt = await createJwt();
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
    expect(ddbMock.calls()).toHaveLength(1);
  });

  test("Test Manager deleting non-existent RSVP (Not Found)", async () => {
    const err = new Error("TransactionCanceledException");
    err.name = "TransactionCanceledException";
    // @ts-ignore
    err.CancellationReasons = [
      { Code: "ConditionalCheckFailed" },
      { Code: "None" },
    ];
    ddbMock.on(TransactWriteItemsCommand).rejects(err);

    const adminJwt = await createJwt();
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

  test("Test Manager deleting RSVP when rsvpCount is already 0 (Safety Check)", async () => {
    const err = new Error("TransactionCanceledException");
    err.name = "TransactionCanceledException";
    // @ts-ignore
    err.CancellationReasons = [
      { Code: "None" },
      { Code: "ConditionalCheckFailed" },
    ];
    ddbMock.on(TransactWriteItemsCommand).rejects(err);

    const adminJwt = await createJwt();
    const eventId = "Make Your Own Database";
    const targetUserId = "user1@illinois.edu";

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}/attendee/${encodeURIComponent(targetUserId)}`,
      headers: {
        Authorization: `Bearer ${adminJwt}`,
      },
    });
    expect(response.statusCode).toBe(500);
  });

  test("Test Manager configuring rsvp limit", async () => {
    ddbMock.on(UpdateItemCommand).resolves({});

    const adminJwt = await createJwt();
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
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.rsvpLimit).toBe(newLimit);
    expect(ddbMock.calls()).toHaveLength(1);
  });

  test("Test Manager configuring non-existent event", async () => {
    const err = new Error("ConditionalCheckFailedException");
    err.name = "ConditionalCheckFailedException";
    ddbMock.on(UpdateItemCommand).rejects(err);

    const adminJwt = await createJwt();
    const eventId = "FakeEventID";

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/rsvp/event/${encodeURIComponent(eventId)}/config`,
      headers: {
        Authorization: `Bearer ${adminJwt}`,
      },
      payload: {
        rsvpLimit: 50,
      },
    });

    expect(response.statusCode).toBe(404);
  });
});
