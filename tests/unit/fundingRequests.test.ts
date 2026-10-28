import { beforeEach, describe, expect, test, vi } from "vitest";
import init from "../../src/api/server.js";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import supertest from "supertest";
import { createJwt } from "./utils.js";
import { genericConfig } from "../../src/common/config.js";
import { AppRoles, allAppRoles } from "../../src/common/roles.js";
import { getUserRoles } from "../../src/api/functions/authorization.js";
import { getUserOrgRoles } from "../../src/api/functions/organizations.js";
import {
  FundingRequestStatus,
  FundingRequestType,
} from "../../src/common/types/fundingRequest.js";

vi.mock("../../src/api/functions/organizations.js", () => ({
  getUserOrgRoles: vi.fn(),
}));

const ddbMock = mockClient(DynamoDBClient);
const app = await init();

// Each test user gets its own email so cached roles never leak between tests.
const ADMIN = "funding-admin@acm.illinois.edu";
const LEAD = "funding-lead@acm.illinois.edu";
const TWO_ORG_LEAD = "funding-two-org-lead@acm.illinois.edu";
const NO_ROLES = "funding-no-roles@acm.illinois.edu";

const rolesByUser: Record<string, AppRoles[]> = {
  [ADMIN]: [AppRoles.FUNDING_REQUEST_VIEW_ALL],
  [LEAD]: [AppRoles.AT_LEAST_ONE_ORG_MANAGER],
  [TWO_ORG_LEAD]: [AppRoles.AT_LEAST_ONE_ORG_MANAGER],
  [NO_ROLES]: [],
};

const jwtFor = (email: string) => createJwt(undefined, [], email);

const makeRow = (
  orgId: string,
  requestId: string,
  createdAt: string,
  extra: Record<string, unknown> = {},
) =>
  marshall({
    semesterId: "fa26",
    "orgId#requestId": `${orgId}#${requestId}`,
    requestId,
    orgId,
    type: FundingRequestType.FUNDING,
    title: `Request ${requestId}`,
    requestedAmountCents: 5000,
    currentStatus: FundingRequestStatus.SUBMITTED,
    createdBy: "someone@illinois.edu",
    createdAt,
    ...extra,
  });

const listUrl = "/api/v1/fundingRequests";

describe("GET /api/v1/fundingRequests", () => {
  beforeEach(() => {
    ddbMock.reset();
    vi.mocked(getUserRoles).mockImplementation(
      async (_client, user) => rolesByUser[user as string] ?? [],
    );
    vi.mocked(getUserOrgRoles).mockReset();
  });

  test("rejects requests without a token", async () => {
    await app.ready();
    const response = await supertest(app.server)
      .get(listUrl)
      .query({ semesterId: "fa26" });
    expect(response.statusCode).toBe(401);
  });

  test("rejects users without a funding request role", async () => {
    await app.ready();
    const response = await supertest(app.server)
      .get(listUrl)
      .query({ semesterId: "fa26" })
      .set("authorization", `Bearer ${jwtFor(NO_ROLES)}`);
    expect(response.statusCode).toBe(403);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  test("requires a semesterId", async () => {
    await app.ready();
    const response = await supertest(app.server)
      .get(listUrl)
      .set("authorization", `Bearer ${jwtFor(ADMIN)}`);
    expect(response.statusCode).toBe(400);
  });

  test("rejects an invalid semesterId", async () => {
    await app.ready();
    const response = await supertest(app.server)
      .get(listUrl)
      .query({ semesterId: "fall2026" })
      .set("authorization", `Bearer ${jwtFor(ADMIN)}`);
    expect(response.statusCode).toBe(400);
  });

  test("view-all users get every request in the semester, newest first", async () => {
    await app.ready();
    ddbMock.on(QueryCommand).resolves({
      Items: [
        makeRow("C01", "older", "2026-10-01T00:00:00.000Z"),
        makeRow("C02", "newer", "2026-10-20T00:00:00.000Z", {
          approvedAmountCents: 4000,
          currentStatus: FundingRequestStatus.APPROVED,
        }),
      ],
    });
    const response = await supertest(app.server)
      .get(listUrl)
      .query({ semesterId: "fa26" })
      .set("authorization", `Bearer ${jwtFor(ADMIN)}`);

    expect(response.statusCode).toBe(200);
    expect(
      response.body.map((x: { requestId: string }) => x.requestId),
    ).toEqual(["newer", "older"]);
    expect(response.body[0]).toMatchObject({
      orgId: "C02",
      status: FundingRequestStatus.APPROVED,
      approvedAmountCents: 4000,
    });
    expect(response.body[0]).not.toHaveProperty("currentStatus");

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toMatchObject({
      TableName: genericConfig.FundingRequestsTableName,
      KeyConditionExpression: "semesterId = :semesterId",
      ExpressionAttributeValues: { ":semesterId": { S: "fa26" } },
    });
    // View-all users never need an org lookup.
    expect(getUserOrgRoles).not.toHaveBeenCalled();
  });

  test("org leads only query the orgs they lead (not orgs they are a member of)", async () => {
    await app.ready();
    vi.mocked(getUserOrgRoles).mockResolvedValue([
      { org: "C01", role: "LEAD" },
      { org: "C02", role: "MEMBER" },
    ]);
    ddbMock.on(QueryCommand).resolves({
      Items: [makeRow("C01", "mine", "2026-10-05T00:00:00.000Z")],
    });
    const response = await supertest(app.server)
      .get(listUrl)
      .query({ semesterId: "fa26" })
      .set("authorization", `Bearer ${jwtFor(LEAD)}`);

    expect(response.statusCode).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].orgId).toBe("C01");

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toMatchObject({
      KeyConditionExpression:
        "semesterId = :semesterId AND begins_with(#sortKey, :orgPrefix)",
      ExpressionAttributeValues: {
        ":semesterId": { S: "fa26" },
        ":orgPrefix": { S: "C01#" },
      },
    });
    expect(calls[0].args[0].input.ExpressionAttributeNames?.["#sortKey"]).toBe(
      "orgId#requestId",
    );
  });

  test("leads of several orgs get all of their orgs' requests merged", async () => {
    await app.ready();
    vi.mocked(getUserOrgRoles).mockResolvedValue([
      { org: "C01", role: "LEAD" },
      { org: "C02", role: "LEAD" },
    ]);
    ddbMock
      .on(QueryCommand, {
        ExpressionAttributeValues: {
          ":semesterId": { S: "fa26" },
          ":orgPrefix": { S: "C01#" },
        },
      })
      .resolves({ Items: [makeRow("C01", "a", "2026-10-01T00:00:00.000Z")] })
      .on(QueryCommand, {
        ExpressionAttributeValues: {
          ":semesterId": { S: "fa26" },
          ":orgPrefix": { S: "C02#" },
        },
      })
      .resolves({ Items: [makeRow("C02", "b", "2026-10-02T00:00:00.000Z")] });

    const response = await supertest(app.server)
      .get(listUrl)
      .query({ semesterId: "fa26" })
      .set("authorization", `Bearer ${jwtFor(TWO_ORG_LEAD)}`);

    expect(response.statusCode).toBe(200);
    expect(
      response.body.map((x: { requestId: string }) => x.requestId),
    ).toEqual(["b", "a"]);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(2);
  });

  test("returns an empty list when the user no longer leads any org", async () => {
    await app.ready();
    vi.mocked(getUserOrgRoles).mockResolvedValue([
      { org: "C01", role: "MEMBER" },
    ]);
    const response = await supertest(app.server)
      .get(listUrl)
      .query({ semesterId: "fa26" })
      .set("authorization", `Bearer ${jwtFor(LEAD)}`);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual([]);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  test("follows DynamoDB pagination", async () => {
    await app.ready();
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({
        Items: [makeRow("C01", "page1", "2026-10-01T00:00:00.000Z")],
        LastEvaluatedKey: marshall({ semesterId: "fa26" }),
      })
      .resolvesOnce({
        Items: [makeRow("C01", "page2", "2026-10-02T00:00:00.000Z")],
      });
    const response = await supertest(app.server)
      .get(listUrl)
      .query({ semesterId: "fa26" })
      .set("authorization", `Bearer ${jwtFor(ADMIN)}`);

    expect(response.statusCode).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(2);
  });

  test("returns a server error when DynamoDB fails", async () => {
    await app.ready();
    ddbMock.on(QueryCommand).rejects(new Error("boom"));
    const response = await supertest(app.server)
      .get(listUrl)
      .query({ semesterId: "fa26" })
      .set("authorization", `Bearer ${jwtFor(ADMIN)}`);
    expect(response.statusCode).toBe(500);
  });

  test("users with every app role are treated as view-all", () => {
    expect(allAppRoles).toContain(AppRoles.FUNDING_REQUEST_VIEW_ALL);
  });
});
