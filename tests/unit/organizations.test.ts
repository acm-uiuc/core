import { afterAll, expect, test, beforeEach, vi, describe } from "vitest";
import init from "../../src/api/index.js";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { SQSClient, SendMessageBatchCommand } from "@aws-sdk/client-sqs";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { createJwt } from "./auth.test.js";
import { marshall } from "@aws-sdk/util-dynamodb";
import { genericConfig } from "../../src/common/config.js";
import { randomUUID } from "node:crypto";
import { createGithubTeam } from "../../src/api/functions/github.js";
import { addLead, removeLead } from "../../src/api/functions/organizations.js";
import { modifyGroup } from "../../src/api/functions/entraId.js";

const app = await init();
const ddbMock = mockClient(DynamoDBClient);
const sqsMock = mockClient(SQSClient);
const smMock = mockClient(SecretsManagerClient);

vi.mock("../../src/api/functions/entraId.js", () => {
  return {
    ...vi.importActual("../../src/api/functions/entraId.js"),
    getEntraIdToken: vi.fn().mockImplementation(async () => {
      return "ey.test.token";
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
    createM365Group: vi.fn().mockImplementation(async () => {
      return randomUUID();
    }),
  };
});
vi.mock("../../src/api/functions/github.js", () => {
  return {
    ...vi.importActual("../../src/api/functions/github.js"),
    createGithubTeam: vi.fn().mockImplementation(async () => {
      return randomUUID();
    }),
    assignIdpGroupsToTeam: vi.fn().mockImplementation(async () => {
      return;
    }),
  };
});

const acmMeta = {
  primaryKey: "DEFINE#ACM",
  leadsEntraGroupId: "a3c37a24-1e21-4338-813f-15478eb40137",
  links: [
    {
      type: "DISCORD",
      url: "https://go.acm.illinois.edu/discord",
    },
  ],
  website: "https://www.acm.illinois.edu",
};

describe("Organization info tests - Extended Coverage", () => {
  beforeEach(() => {
    (app as any).nodeCache.flushAll();
    ddbMock.reset();
    sqsMock.reset();
    smMock.reset();
    vi.clearAllMocks();
  });

  describe("GET /organizations - List all organizations", () => {
    test("Returns list with authenticated user seeing EntraGroupId", async () => {
      const testJwt = createJwt();

      ddbMock.on(QueryCommand).resolves({
        Items: [marshall(acmMeta)],
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/organizations",
        headers: { authorization: `Bearer ${testJwt}` },
      });

      expect(response.statusCode).toBe(200);
      const responseJson = response.json();
      expect(responseJson).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
          }),
        ]),
      );
    });

    test("Returns list without EntraGroupId for unauthenticated user", async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [marshall(acmMeta)],
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/organizations",
      });

      expect(response.statusCode).toBe(200);
      const responseJson = response.json();
      responseJson.forEach((org: any) => {
        expect(org.leadsEntraGroupId).toBeUndefined();
      });
    });

    test("Cache-Control header is set correctly", async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/organizations",
      });

      expect(response.headers["cache-control"]).toContain("public");
      expect(response.headers["cache-control"]).toContain("max-age=300");
    });
  });

  describe("GET /organizations/:orgId - Get specific organization", () => {
    test("Returns EntraGroupId for authenticated user", async () => {
      const testJwt = createJwt();

      ddbMock
        .on(QueryCommand)
        .resolvesOnce({
          Items: [marshall(acmMeta)],
        })
        .resolvesOnce({
          Items: [],
        });

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/organizations/ACM",
        headers: { authorization: `Bearer ${testJwt}` },
      });

      expect(response.statusCode).toBe(200);
      const responseJson = response.json();
      expect(responseJson.leadsEntraGroupId).toBe(acmMeta.leadsEntraGroupId);
    });

    test("Hides EntraGroupId for unauthenticated user", async () => {
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({
          Items: [marshall(acmMeta)],
        })
        .resolvesOnce({
          Items: [],
        });

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/organizations/ACM",
      });

      expect(response.statusCode).toBe(200);
      const responseJson = response.json();
      expect(responseJson.leadsEntraGroupId).toBeUndefined();
    });

    test("Invalid organization ID returns 400", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/organizations/INVALID_ORG",
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("POST /organizations/:orgId/meta - Set organization metadata", () => {
    test("Successfully updates metadata with proper role", async () => {
      const testJwt = createJwt();
      ddbMock.on(TransactWriteItemsCommand).resolves({});

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/organizations/ACM/meta",
        headers: { authorization: `Bearer ${testJwt}` },
        payload: {
          website: "https://new.acm.illinois.edu",
          links: [{ type: "DISCORD", url: "https://discord.gg/new" }],
        },
      });

      expect(response.statusCode).toBe(201);
      expect(ddbMock.commandCalls(TransactWriteItemsCommand).length).toBe(1);
    });

    test("Organization lead can update metadata", async () => {
      const testJwt = createJwt();

      // Mock getUserOrgRoles to return LEAD role for this user
      ddbMock
        .on(QueryCommand, {
          TableName: genericConfig.SigInfoTableName,
          IndexName: "UsernameIndex",
          KeyConditionExpression: `username = :username`,
          ExpressionAttributeValues: {
            ":username": { S: "lead@illinois.edu" },
          },
        })
        .resolves({
          Items: [
            marshall({
              username: "lead@illinois.edu",
              primaryKey: "LEAD#ACM",
            }),
          ],
        });

      ddbMock.on(TransactWriteItemsCommand).resolves({});

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/organizations/ACM/meta",
        headers: { authorization: `Bearer ${testJwt}` },
        payload: {
          website: "https://new.acm.illinois.edu",
        },
      });

      expect(response.statusCode).toBe(201);
    });

    test("Non-lead without role cannot update metadata", async () => {
      const testJwt = createJwt(undefined, [], "rando@acm.illinois.edu");
      ddbMock
        .on(QueryCommand, {
          TableName: genericConfig.SigInfoTableName,
          IndexName: "UsernameIndex",
          KeyConditionExpression: `username = :username`,
          ExpressionAttributeValues: {
            ":username": { S: "rando@acm.illinois.edu" },
          },
        })
        .resolves({
          Items: [
            marshall({
              username: "rando@acm.illinois.edu",
              primaryKey: "MEMBER#ACM",
            }),
          ],
        });

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/organizations/ACM/meta",
        headers: { authorization: `Bearer ${testJwt}` },
        payload: {
          website: "https://new.acm.illinois.edu",
        },
      });

      expect(response.statusCode).toBe(401);
    });

    test("Handles database errors gracefully", async () => {
      const testJwt = createJwt();

      ddbMock
        .on(TransactWriteItemsCommand)
        .rejects(new Error("Database error"));

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/organizations/ACM/meta",
        headers: { authorization: `Bearer ${testJwt}` },
        payload: {
          website: "https://new.acm.illinois.edu",
        },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().message).toContain(
        "Failed to set org information",
      );
    });
  });

  describe("PATCH /organizations/:orgId/leads - Manage organization leads", () => {
    test("Validates duplicate usernames in request", async () => {
      const testJwt = createJwt();

      const response = await app.inject({
        method: "PATCH",
        url: "/api/v1/organizations/ACM/leads",
        headers: { authorization: `Bearer ${testJwt}` },
        payload: {
          add: [
            {
              username: "duplicate@illinois.edu",
              name: "User One",
              title: "Lead",
            },
            {
              username: "duplicate@illinois.edu",
              name: "User Two",
              title: "Co-Lead",
            },
          ],
          remove: [],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain(
        "Each user can only be specified once",
      );
    });

    test("Validates paid membership for new leads", async () => {
      const testJwt = createJwt();

      // Mock unpaid membership
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const response = await app.inject({
        method: "PATCH",
        url: "/api/v1/organizations/ACM/leads",
        headers: { authorization: `Bearer ${testJwt}` },
        payload: {
          add: [
            {
              username: "unpaid@illinois.edu",
              name: "Unpaid User",
              title: "Lead",
            },
          ],
          remove: [],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain("not ACM paid members");
    });

    test("Successfully adds and removes leads with Entra + GitHub integration", async () => {
      const testJwt = createJwt();

      // Mock GetItemCommand for org metadata
      ddbMock
        .on(GetItemCommand, { TableName: genericConfig.SigInfoTableName })
        .resolves({
          Item: marshall({ leadsEntraGroupId: "test-entra-group-id" }),
        });
      // Mock getUserOrgRoles to return LEAD role for this user
      ddbMock
        .on(QueryCommand, {
          TableName: genericConfig.SigInfoTableName,
          IndexName: "UsernameIndex",
          KeyConditionExpression: `username = :username`,
          ExpressionAttributeValues: {
            ":username": { S: "oldlead@illinois.edu" },
          },
        })
        .resolves({
          Items: [
            marshall({
              username: "oldlead@illinois.edu",
              primaryKey: "LEAD#Social Committee",
            }),
          ],
        });
      ddbMock.on(TransactWriteItemsCommand).resolves({});

      sqsMock.on(SendMessageBatchCommand).resolves({
        Successful: [
          {
            Id: "1",
            MessageId: "msg-1",
            MD5OfMessageBody: "mock-md5",
          },
        ],
        Failed: [],
      });

      const response = await app.inject({
        method: "PATCH",
        url: "/api/v1/organizations/Social Committee/leads",
        headers: { authorization: `Bearer ${testJwt}` },
        payload: {
          add: [
            {
              username: "newlead@illinois.edu",
              name: "New Lead",
              title: "President",
            },
          ],
          remove: ["oldlead@illinois.edu"],
        },
      });

      expect(response.statusCode).toBe(201);
      expect(
        ddbMock.commandCalls(TransactWriteItemsCommand).length,
      ).toBeGreaterThan(0);
      expect(createGithubTeam).toHaveBeenCalledOnce();
      expect(createGithubTeam).toHaveBeenCalledWith(
        expect.objectContaining({
          githubToken: "abc123testing",
          orgId: "acm-uiuc-testing",
          name: "social-adm-nonprod",
          description: "Social Committee Admin",
          parentTeamId: 14420860,
        }),
      );
    });

    test("Successfully adds and removes Officers but skips Entra + GitHub integration", async () => {
      const testJwt = createJwt();

      // Mock GetItemCommand for org metadata
      ddbMock
        .on(GetItemCommand, { TableName: genericConfig.SigInfoTableName })
        .resolves({
          Item: marshall({ leadsEntraGroupID: "abc" }),
        });
      // Mock getUserOrgRoles to return LEAD role for this user
      ddbMock
        .on(QueryCommand, {
          TableName: genericConfig.SigInfoTableName,
          IndexName: "UsernameIndex",
          KeyConditionExpression: `username = :username`,
          ExpressionAttributeValues: {
            ":username": { S: "oldlead@illinois.edu" },
          },
        })
        .resolves({
          Items: [
            marshall({
              username: "oldlead@illinois.edu",
              primaryKey: "LEAD#ACM",
            }),
          ],
        });
      ddbMock.on(TransactWriteItemsCommand).resolves({});

      sqsMock.on(SendMessageBatchCommand).resolves({
        Successful: [
          {
            Id: "1",
            MessageId: "msg-1",
            MD5OfMessageBody: "mock-md5",
          },
        ],
        Failed: [],
      });

      const response = await app.inject({
        method: "PATCH",
        url: "/api/v1/organizations/ACM/leads",
        headers: { authorization: `Bearer ${testJwt}` },
        payload: {
          add: [
            {
              username: "newlead@illinois.edu",
              name: "New Lead",
              title: "President",
            },
          ],
          remove: ["oldlead@illinois.edu"],
        },
      });

      expect(response.statusCode).toBe(201);
      expect(
        ddbMock.commandCalls(TransactWriteItemsCommand).length,
      ).toBeGreaterThan(0);
      expect(createGithubTeam).toHaveBeenCalledTimes(0);
      expect(modifyGroup).toHaveBeenCalledTimes(0);
    });

    test("Organization lead can manage other leads", async () => {
      const testJwt = createJwt();

      ddbMock
        .on(QueryCommand, {
          TableName: genericConfig.SigInfoTableName,
          IndexName: "UsernameIndex",
        })
        .resolves({
          Items: [
            marshall({
              username: "currentlead@illinois.edu",
              primaryKey: "LEAD#ACM",
            }),
          ],
        });

      // Mock paid membership
      ddbMock.on(QueryCommand).resolves({
        Items: [marshall({ membershipStatus: "PAID" })],
      });

      ddbMock.on(GetItemCommand).resolves({ Item: undefined });
      smMock.on(GetSecretValueCommand).resolves({
        SecretString: JSON.stringify({ token: "mock-token" }),
      });
      ddbMock.on(TransactWriteItemsCommand).resolves({});

      const response = await app.inject({
        method: "PATCH",
        url: "/api/v1/organizations/ACM/leads",
        headers: { authorization: `Bearer ${testJwt}` },
        payload: {
          add: [
            { username: "newlead@illinois.edu", name: "New Lead", title: "VP" },
          ],
          remove: [],
        },
      });

      expect(response.statusCode).toBe(201);
    });

    test("Handles missing Entra group ID gracefully", async () => {
      const testJwt = createJwt(undefined, [], "rando@acm.illinois.edu");

      ddbMock
        .on(QueryCommand, {
          TableName: genericConfig.SigInfoTableName,
          IndexName: "UsernameIndex",
          KeyConditionExpression: `username = :username`,
          ExpressionAttributeValues: {
            ":username": { S: "rando@acm.illinois.edu" },
          },
        })
        .resolves({
          Items: [
            marshall({
              username: "rando@acm.illinois.edu",
              primaryKey: "LEAD#ACM",
            }),
          ],
        });

      ddbMock.on(GetItemCommand).resolves({ Item: undefined });

      smMock.on(GetSecretValueCommand).resolves({
        SecretString: JSON.stringify({ token: "mock-token" }),
      });

      ddbMock.on(TransactWriteItemsCommand).resolves({});

      const response = await app.inject({
        method: "PATCH",
        url: "/api/v1/organizations/ACM/leads",
        headers: { authorization: `Bearer ${testJwt}` },
        payload: {
          add: [
            {
              username: "valid@illinois.edu",
              name: "Valid User",
              title: "Lead",
            },
          ],
          remove: [],
        },
      });

      expect(response.statusCode).toBe(201);
    });
  });

  afterAll(async () => {
    await app.close();
  });
});
