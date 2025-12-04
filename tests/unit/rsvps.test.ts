import { expect, test, vi, describe, beforeEach } from "vitest";
import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import init from "../../src/api/index.js";
import { createJwt } from "./auth.test.js";
import { testSecretObject } from "./secret.testdata.js";
import { Redis } from "../../src/api/types.js";
import { FastifyBaseLogger } from "fastify";

const DUMMY_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

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
          if (token === DUMMY_JWT) {
            console.log("DUMMY_JWT matched in mock implementation");
          }
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
const jwt_secret = testSecretObject["jwt_key"];
vi.stubEnv("JwtSigningKey", jwt_secret);

const app = await init();

describe("RSVP API tests", () => {
  beforeEach(() => {
    ddbMock.reset();
    vi.clearAllMocks();
  });

  test("Test posting an RSVP for an event", async () => {
    ddbMock.on(PutItemCommand).resolves({});

    const testJwt = createJwt();
    const mockUpn = "jd3@illinois.edu";
    const eventId = "Make Your Own Database";
    const orgId = "SIGDatabase";

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/rsvp/${orgId}/event/${encodeURIComponent(eventId)}`,
      headers: {
        Authorization: `Bearer ${testJwt}`,
        "x-uiuc-token": DUMMY_JWT,
      },
    });

    if (response.statusCode !== 201) {
      console.log("Test Failed Response:", response.body);
    }

    expect(response.statusCode).toBe(201);

    const body = JSON.parse(response.body);
    expect(body.userId).toBe(mockUpn);
    expect(body.eventId).toBe(eventId);
    expect(body.isPaidMember).toBe(true);
    expect(body.partitionKey).toBe(`${eventId}#${mockUpn}`);

    expect(ddbMock.calls()).toHaveLength(1);
    const putItemInput = ddbMock.call(0).args[0].input as any;
    expect(putItemInput.TableName).toBe("infra-core-api-events-rsvp");
  });

  test("Test getting RSVPs for an event (Mocking Query Response)", async () => {
    const eventId = "Make Your Own Database";
    const orgId = "SIGDatabase";
    const mockRsvps = [
      {
        eventId,
        userId: "user1@illinois.edu",
        isPaidMember: true,
        createdAt: "2023-01-01",
      },
      {
        eventId,
        userId: "user2@illinois.edu",
        isPaidMember: false,
        createdAt: "2023-01-02",
      },
    ];
    ddbMock.on(QueryCommand).resolves({
      Items: mockRsvps.map((item) => marshall(item)),
    });

    const adminJwt = await createJwt();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/rsvp/${orgId}/event/${encodeURIComponent(eventId)}`,
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
});
