import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  beforeEach,
  vi,
} from "vitest";
import init from "../../src/api/server.js";
import { createJwt } from "./utils.js";
import supertest from "supertest";
import { EntraGroupError } from "../../src/common/errors/index.js";
import {
  SendMessageBatchCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";

import { AvailableSQSFunctions } from "../../src/common/types/sqsMessage.js";
import { AppRoles } from "../../src/common/roles.js";
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
const cloudflareGroupId = "d717c1d8-665c-4132-a702-a394935112af";

const queuedJobs = () =>
  sqsMock
    .commandCalls(SendMessageBatchCommand)
    .flatMap((call) =>
      call.args[0].input.Entries!.map((entry) =>
        JSON.parse(entry.MessageBody!),
      ),
    );

describe("Test Modify Group and List Group Routes", () => {
  beforeAll(async () => {
    await app.ready();
  });
  beforeEach(() => {
    (app as any).redisClient.flushall();
    sqsMock.reset();
    vi.clearAllMocks();
    app.runEnvironment = "dev";
    app.secretConfig.cloudflare_infra_team_group_id = cloudflareGroupId;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    app.runEnvironment = "dev";
    delete app.secretConfig.cloudflare_infra_team_group_id;
    vi.useRealTimers();
  });

  describe("Cloudflare membership routing", () => {
    beforeEach(() => {
      vi.spyOn(app, "authorize").mockImplementation(async (request) => {
        request.username = "infra-unit-test@acm.illinois.edu";
        request.userRoles = new Set([AppRoles.IAM_ADMIN]);
        return request.userRoles;
      });
    });
    test("Production InfraTeamMember queues isolated actions alongside notifications in batches of ten", async () => {
      app.runEnvironment = "prod";
      sqsMock
        .on(SendMessageBatchCommand)
        .resolves({ $metadata: { requestId: "queue-123" } });
      const addedEmails = Array.from(
        { length: 6 },
        (_, i) => `added${i}@illinois.edu`,
      );
      const removedEmails = ["removed@illinois.edu"];
      const response = await supertest(app.server)
        .patch(`/api/v1/iam/groups/${cloudflareGroupId}`)
        .set("authorization", `Bearer ${createJwt()}`)
        .send({ add: addedEmails, remove: removedEmails });

      expect(response.statusCode).toBe(202);
      expect(response.body).toEqual({
        success: [...addedEmails, ...removedEmails].map((email) => ({ email })),
        failure: [],
      });
      const jobs = queuedJobs();
      const syncJobs = jobs.filter(
        (job) => job.function === AvailableSQSFunctions.SyncCloudflareMember,
      );
      expect(syncJobs.map((job) => job.payload)).toEqual([
        ...addedEmails.map((email) => ({ email, action: "add" })),
        ...removedEmails.map((email) => ({ email, action: "remove" })),
      ]);
      const notifications = jobs.filter(
        (job) => job.function === AvailableSQSFunctions.EmailNotifications,
      );
      expect(notifications).toHaveLength(
        addedEmails.length + removedEmails.length,
      );
      for (const job of syncJobs) {
        expect(job.metadata).toEqual(notifications[0].metadata);
        expect(job.metadata.initiator).toBe("infra-unit-test@acm.illinois.edu");
      }
      expect(
        sqsMock
          .commandCalls(SendMessageBatchCommand)
          .map((call) => call.args[0].input.Entries!.length),
      ).toEqual([10, 2, 2]);
    });

    test.each([
      { environment: "dev" as const, groupId: cloudflareGroupId },
      { environment: "prod" as const, groupId: "another-group-id" },
    ])(
      "$environment / $groupId does not sync Cloudflare",
      async ({ environment, groupId }) => {
        app.runEnvironment = environment;
        sqsMock
          .on(SendMessageBatchCommand)
          .resolves({ $metadata: { requestId: "queue-123" } });
        const response = await supertest(app.server)
          .patch(`/api/v1/iam/groups/${groupId}`)
          .set("authorization", `Bearer ${createJwt()}`)
          .send({
            add: ["added@illinois.edu"],
            remove: ["removed@illinois.edu"],
          });
        expect(response.statusCode).toBe(202);
        expect(queuedJobs().map((job) => job.function)).toEqual([
          AvailableSQSFunctions.EmailNotifications,
          AvailableSQSFunctions.EmailNotifications,
        ]);
      },
    );

    test("Failed Entra additions and removals do not queue Cloudflare jobs", async () => {
      app.runEnvironment = "prod";
      sqsMock
        .on(SendMessageBatchCommand)
        .resolves({ $metadata: { requestId: "queue-123" } });
      const response = await supertest(app.server)
        .patch(`/api/v1/iam/groups/${cloudflareGroupId}`)
        .set("authorization", `Bearer ${createJwt()}`)
        .send({
          add: ["added@illinois.edu", "failed-add@example.com"],
          remove: ["removed@illinois.edu", "failed-remove@example.com"],
        });
      expect(response.statusCode).toBe(202);
      expect(response.body.success).toEqual([
        { email: "added@illinois.edu" },
        { email: "removed@illinois.edu" },
      ]);
      expect(
        response.body.failure.map((entry: { email: string }) => entry.email),
      ).toEqual(["failed-add@example.com", "failed-remove@example.com"]);
      expect(
        queuedJobs()
          .filter(
            (job) =>
              job.function === AvailableSQSFunctions.SyncCloudflareMember,
          )
          .map((job) => job.payload),
      ).toEqual([
        { email: "added@illinois.edu", action: "add" },
        { email: "removed@illinois.edu", action: "remove" },
      ]);
    });
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
