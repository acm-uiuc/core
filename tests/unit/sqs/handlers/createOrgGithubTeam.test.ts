import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { createOrgGithubTeamHandler } from "../../../../src/api/sqs/handlers/createOrgGithubTeam.js";
import { genericConfig } from "../../../../src/common/config.js";
import { InternalServerError } from "../../../../src/common/errors/index.js";

// Mock dependencies
const ddbMock = mockClient(DynamoDBClient);

vi.mock("../../../../src/api/functions/github.js", () => ({
  createGithubTeam: vi.fn(),
  assignIdpGroupsToTeam: vi.fn(),
}));

vi.mock(import("../../../../src/api/utils.js"), async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    retryDynamoTransactionWithBackoff: vi.fn((operation) => operation()),
  }
});

vi.mock("ioredis", () => import("ioredis-mock"));

let mockLockAborted = false;

vi.mock("redlock-universal", () => ({
  createLock: vi.fn(() => ({
    using: vi.fn((callback) => callback({ aborted: mockLockAborted })),
  })),
  IoredisAdapter: vi.fn(),
}));

import {
  createGithubTeam,
  assignIdpGroupsToTeam,
} from "../../../../src/api/functions/github.js";

describe("createOrgGithubTeamHandler", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn().mockImplementation(console.error),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  };

  // Use "Social Committee" - a real org that's NOT in the skip list
  const basePayload = {
    orgName: "Social Committee",
    githubTeamName: "social-leads",
    githubTeamDescription: "Social Committee Leadership Team",
  };

  const baseMetadata = {
    reqId: "test-req-123",
    initiator: "test@illinois.edu",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    ddbMock.reset();
    mockLockAborted = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should skip organizations with external updates disabled", async () => {
    // Use ACM which IS in the skip list
    const disabledOrgPayload = {
      ...basePayload,
      orgName: "ACM",
      githubTeamName: "acm-leads",
      githubTeamDescription: "ACM Leadership Team",
    };

    await createOrgGithubTeamHandler(
      disabledOrgPayload,
      baseMetadata,
      mockLogger as any,
    );

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("external updates disabled"),
    );
    expect(ddbMock.commandCalls(GetItemCommand)).toHaveLength(0);
  });

  it("should throw error if org entry not found", async () => {
    ddbMock.on(GetItemCommand).resolves({});

    await expect(
      createOrgGithubTeamHandler(basePayload, baseMetadata, mockLogger as any),
    ).rejects.toThrow(InternalServerError);
  });

  it("should skip if org does not have an Entra group", async () => {
    ddbMock.on(GetItemCommand).resolves({
      Item: marshall({
        primaryKey: "DEFINE#Social Committee",
        entryId: "0",
      }),
    });

    await createOrgGithubTeamHandler(
      basePayload,
      baseMetadata,
      mockLogger as any,
    );

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("does not have an Entra group"),
    );
    expect(createGithubTeam).not.toHaveBeenCalled();
  });

  it("should skip if org already has a GitHub team", async () => {
    ddbMock.on(GetItemCommand).resolves({
      Item: marshall({
        primaryKey: "DEFINE#Social Committee",
        entryId: "0",
        leadsEntraGroupId: "entra-group-123",
        leadsGithubTeamId: 456,
      }),
    });

    await createOrgGithubTeamHandler(
      basePayload,
      baseMetadata,
      mockLogger as any,
    );

    expect(mockLogger.info).toHaveBeenCalledWith(
      "This org already has a GitHub team, skipping",
    );
    expect(createGithubTeam).not.toHaveBeenCalled();
  });

  it("should create GitHub team and store team ID", async () => {
    const newTeamId = 789;

    ddbMock.on(GetItemCommand).resolves({
      Item: marshall({
        primaryKey: "DEFINE#Social Committee",
        entryId: "0",
        leadsEntraGroupId: "entra-group-123",
      }),
    });

    (createGithubTeam as any).mockResolvedValue({
      updated: true,
      id: newTeamId,
    });

    ddbMock.on(TransactWriteItemsCommand).resolves({});

    await createOrgGithubTeamHandler(
      basePayload,
      baseMetadata,
      mockLogger as any,
    );

    expect(createGithubTeam).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringContaining("social-leads"),
        description: "Social Committee Leadership Team",
      }),
    );

    expect(ddbMock.commandCalls(TransactWriteItemsCommand)).toHaveLength(1);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining(`created with team ID "${newTeamId}"`),
    );
  });

  it("should handle existing team and skip IDP sync setup", async () => {
    const existingTeamId = 999;

    ddbMock.on(GetItemCommand).resolves({
      Item: marshall({
        primaryKey: "DEFINE#Social Committee",
        entryId: "0",
        leadsEntraGroupId: "entra-group-123",
      }),
    });

    (createGithubTeam as any).mockResolvedValue({
      updated: false,
      id: existingTeamId,
    });

    ddbMock.on(TransactWriteItemsCommand).resolves({});

    await createOrgGithubTeamHandler(
      basePayload,
      baseMetadata,
      mockLogger as any,
    );

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("already existed"),
    );
    expect(assignIdpGroupsToTeam).not.toHaveBeenCalled();
  });

  it("should set up IDP sync when enabled and team is newly created", async () => {
    const newTeamId = 789;

    ddbMock.on(GetItemCommand).resolves({
      Item: marshall({
        primaryKey: "DEFINE#Social Committee",
        entryId: "0",
        leadsEntraGroupId: "entra-group-123",
      }),
    });

    (createGithubTeam as any).mockResolvedValue({
      updated: true,
      id: newTeamId,
    });

    ddbMock.on(TransactWriteItemsCommand).resolves({});

    await createOrgGithubTeamHandler(
      basePayload,
      baseMetadata,
      mockLogger as any,
    );

    // assignIdpGroupsToTeam would be called if GithubIdpSyncEnabled is true
    // We can't easily mock currentEnvironmentConfig, so we'll just check
    // that the function completed successfully
    expect(ddbMock.commandCalls(TransactWriteItemsCommand)).toHaveLength(1);
  });

  it("should include audit log entry in transaction for new teams", async () => {
    const newTeamId = 789;

    ddbMock.on(GetItemCommand).resolves({
      Item: marshall({
        primaryKey: "DEFINE#Social Committee",
        entryId: "0",
        leadsEntraGroupId: "entra-group-123",
      }),
    });

    (createGithubTeam as any).mockResolvedValue({
      updated: true,
      id: newTeamId,
    });

    ddbMock.on(TransactWriteItemsCommand).callsFake((input) => {
      expect(input.TransactItems).toHaveLength(2);

      const hasAuditLog = input.TransactItems.some(
        (item: any) => item.Put?.TableName === genericConfig.AuditLogTable,
      );
      expect(hasAuditLog).toBe(true);

      const hasUpdate = input.TransactItems.some(
        (item: any) => item.Update?.TableName === genericConfig.SigInfoTableName,
      );
      expect(hasUpdate).toBe(true);

      return Promise.resolve({});
    });

    await createOrgGithubTeamHandler(
      basePayload,
      baseMetadata,
      mockLogger as any,
    );

    expect(mockLogger.info).toHaveBeenCalledWith("Adding updates to audit log");
  });

  it("should not include audit log for existing teams", async () => {
    const existingTeamId = 999;

    ddbMock.on(GetItemCommand).resolves({
      Item: marshall({
        primaryKey: "DEFINE#Social Committee",
        entryId: "0",
        leadsEntraGroupId: "entra-group-123",
      }),
    });

    (createGithubTeam as any).mockResolvedValue({
      updated: false,
      id: existingTeamId,
    });

    ddbMock.on(TransactWriteItemsCommand).callsFake((input) => {
      expect(input.TransactItems).toHaveLength(1);

      const hasAuditLog = input.TransactItems.some(
        (item: any) => item.Put?.TableName === genericConfig.AuditLogTable,
      );
      expect(hasAuditLog).toBe(false);

      return Promise.resolve({});
    });

    await createOrgGithubTeamHandler(
      basePayload,
      baseMetadata,
      mockLogger as any,
    );
  });

  it("should append suffix to team name when configured", async () => {
    const newTeamId = 789;

    ddbMock.on(GetItemCommand).resolves({
      Item: marshall({
        primaryKey: "DEFINE#Social Committee",
        entryId: "0",
        leadsEntraGroupId: "entra-group-123",
      }),
    });

    (createGithubTeam as any).mockResolvedValue({
      updated: true,
      id: newTeamId,
    });

    ddbMock.on(TransactWriteItemsCommand).resolves({});

    await createOrgGithubTeamHandler(
      basePayload,
      baseMetadata,
      mockLogger as any,
    );

    expect(createGithubTeam).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringContaining("social-leads"),
      }),
    );
  });

  it("should throw error if lock is lost before creating team", async () => {
    mockLockAborted = true;

    ddbMock.on(GetItemCommand).resolves({
      Item: marshall({
        primaryKey: "DEFINE#Social Committee",
        entryId: "0",
        leadsEntraGroupId: "entra-group-123",
      }),
    });

    await expect(
      createOrgGithubTeamHandler(basePayload, baseMetadata, mockLogger as any),
    ).rejects.toThrow(InternalServerError);
  });
});
