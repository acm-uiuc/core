import { afterAll, expect, test, beforeEach, vi } from "vitest";
import init from "../../src/api/server.js";
import { createJwt } from "./auth.test.js";
import supertest from "supertest";
import { describe } from "node:test";
import { EntraGroupError } from "../../src/common/errors/index.js";
import {
  SendMessageBatchCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";

// Mock required dependencies - their real impl's are defined in the beforeEach section.
vi.mock("../../src/api/functions/entraId.js", () => {
  return {
    ...vi.importActual("../../src/api/functions/entraId.js"),
    getEntraIdToken: vi.fn().mockImplementation(async () => {
      return "";
    }),
    modifyGroup: vi.fn().mockImplementation(async () => {
      return "";
    }),
    resolveEmailToOid: vi.fn().mockImplementation(async () => {
      return "";
    }),
    listGroupMembers: vi.fn().mockImplementation(async () => {
      return "";
    }),
    getGroupMetadata: vi.fn().mockImplementation(async () => {
      return { id: "abc123", displayName: "thing" };
    }),
  };
});

const sqsMock = mockClient(SQSClient);

import {
  modifyGroup,
  listGroupMembers,
  getEntraIdToken,
  resolveEmailToOid,
} from "../../src/api/functions/entraId.js";
import { EntraGroupActions } from "../../src/common/types/iam.js";
import { randomUUID } from "crypto";
import { mockClient } from "aws-sdk-client-mock";
const app = await init();

describe("Test Modify Group and List Group Routes", () => {
  beforeEach(() => {
    (app as any).nodeCache.flushAll();
    (app as any).redisClient.flushall();
    sqsMock.reset();
    vi.clearAllMocks();
  });

  test("Modify group: Add and remove members", async () => {
    const queueId = randomUUID();
    sqsMock
      .on(SendMessageBatchCommand)
      .resolves({ $metadata: { requestId: queueId } });
    const testJwt = createJwt();
    await app.ready();

    const response = await supertest(app.server)
      .patch("/api/v1/iam/groups/test-group-id")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        add: ["validuser1@illinois.edu"],
        remove: ["validuser2@illinois.edu"],
      });
    sqsMock.on(SendMessageCommand).resolves({});
    expect(response.statusCode).toBe(202);
    expect(modifyGroup).toHaveBeenCalledTimes(2);
    expect(modifyGroup).toHaveBeenNthCalledWith(
      1,
      "ey.test.token",
      "validuser1@illinois.edu",
      "test-group-id",
      EntraGroupActions.ADD,
      expect.any(Object), // Matches any object
    );

    expect(modifyGroup).toHaveBeenNthCalledWith(
      2,
      "ey.test.token",
      "validuser2@illinois.edu",
      "test-group-id",
      EntraGroupActions.REMOVE,
      expect.any(Object), // Matches any object
    );
    expect(response.body.success).toEqual([
      { email: "validuser1@illinois.edu" },
      { email: "validuser2@illinois.edu" },
    ]);
    expect(response.body.failure).toEqual([]);
    expect(sqsMock.calls()).toHaveLength(2);
  });

  test("Modify group: Fail for invalid email domain", async () => {
    const testJwt = createJwt();
    await app.ready();
    sqsMock.on(SendMessageBatchCommand).rejects();
    const response = await supertest(app.server)
      .patch("/api/v1/iam/groups/test-group-id")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        add: ["invaliduser@example.com"],
        remove: [],
      });

    expect(response.statusCode).toBe(202);
    expect(modifyGroup).toHaveBeenCalledTimes(1);
    expect(response.body.success).toEqual([]);
    expect(response.body.failure).toEqual([
      {
        email: "invaliduser@example.com",
        message:
          "User's domain must be illinois.edu to be added or removed from the group.",
      },
    ]);
    expect(sqsMock.calls()).toHaveLength(0);
  });

  test("List group members: Happy path", async () => {
    const testJwt = createJwt();
    await app.ready();

    const response = await supertest(app.server)
      .get("/api/v1/iam/groups/test-group-id")
      .set("authorization", `Bearer ${testJwt}`);
    expect(response.statusCode).toBe(200);
    expect(listGroupMembers).toHaveBeenCalledWith(
      "ey.test.token",
      "test-group-id",
    );
    expect(response.body).toEqual([
      { name: "John Doe", email: "john.doe@illinois.edu" },
      { name: "Jane Doe", email: "jane.doe@illinois.edu" },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    (app as any).nodeCache.flushAll();
    (app as any).redisClient.flushall();
    vi.clearAllMocks();
    vi.useFakeTimers();
    (getEntraIdToken as any).mockImplementation(async () => {
      return "ey.test.token";
    });
    (modifyGroup as any).mockImplementation(
      async (_token, email, group, _action) => {
        if (!email.endsWith("@illinois.edu")) {
          throw new EntraGroupError({
            code: 400,
            message:
              "User's domain must be illinois.edu to be added or removed from the group.",
            group,
          });
        }
        return true;
      },
    );
    (resolveEmailToOid as any).mockImplementation(async (_token, email) => {
      if (email === "invaliduser@example.com") {
        throw new Error("User not found");
      }
      return "mocked-oid";
    });
    (listGroupMembers as any).mockImplementation(async (_token, group) => {
      if (group === "nonexistent-group-id") {
        throw new EntraGroupError({
          code: 404,
          message: "Group not found.",
          group,
        });
      }
      return [
        { name: "John Doe", email: "john.doe@illinois.edu" },
        { name: "Jane Doe", email: "jane.doe@illinois.edu" },
      ];
    });
  });
});
