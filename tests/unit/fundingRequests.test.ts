import { beforeEach, describe, expect, test, vi } from "vitest";
import init from "../../src/api/server.js";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBClient,
  QueryCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import supertest from "supertest";
import { createJwt } from "./utils.js";
import { genericConfig } from "../../src/common/config.js";
import { AppRoles, allAppRoles } from "../../src/common/roles.js";
import { getUserRoles } from "../../src/api/functions/authorization.js";
import { getUserOrgRoles } from "../../src/api/functions/organizations.js";
import { FundingRequestStatus } from "../../src/common/types/fundingRequest.js";

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

const fundingBody = {
  semesterId: "fa26",
  orgId: "C01",
  title: "Hackathon pizza",
  description: "Pizza for 60 attendees at the fall hackathon.",
  requestedAmountCents: 45000,
};

// Every attribute the main table schema defines, except approvedAmountCents,
// which only the treasurer sets.
const mainTableColumns = [
  "semesterId",
  "orgId#requestId",
  "requestId",
  "orgId",
  "title",
  "description",
  "requestedAmountCents",
  "currentStatus",
  "createdBy",
  "createdAt",
  "updatedAt",
  "expiresAt",
];

// LEAD has the meta role, so it passes the route's role check;
// getUserOrgRoles decides which org they actually lead.
const makeLeadOf = (org: string) => {
  vi.mocked(getUserOrgRoles).mockResolvedValue([
    { org: org as any, role: "LEAD" },
  ]);
};

const sentItems = () => {
  const calls = ddbMock.commandCalls(TransactWriteItemsCommand);
  expect(calls.length).toBe(1);
  return calls[0].args[0].input.TransactItems!;
};

describe("POST /api/v1/fundingRequests", () => {
  beforeEach(() => {
    ddbMock.reset();
    vi.mocked(getUserRoles).mockImplementation(
      async (_client, user) => rolesByUser[user as string] ?? [],
    );
    vi.mocked(getUserOrgRoles).mockReset();
    vi.mocked(getUserOrgRoles).mockResolvedValue([]);
  });

  test("Rejects a request with no token", async () => {
    await app.ready();
    const response = await supertest(app.server)
      .post(listUrl)
      .send(fundingBody);
    expect(response.statusCode).toBe(401);
  });

  test("Rejects a user who does not lead any org", async () => {
    await app.ready();
    const response = await supertest(app.server)
      .post(listUrl)
      .set("authorization", `Bearer ${jwtFor(LEAD)}`)
      .send(fundingBody);
    expect(response.statusCode).toBe(403);
    expect(ddbMock.commandCalls(TransactWriteItemsCommand).length).toBe(0);
  });

  test("Rejects a lead creating a request for an org they don't lead", async () => {
    await app.ready();
    makeLeadOf("S01");
    const response = await supertest(app.server)
      .post(listUrl)
      .set("authorization", `Bearer ${jwtFor(LEAD)}`)
      .send(fundingBody);
    expect(response.statusCode).toBe(403);
    expect(ddbMock.commandCalls(TransactWriteItemsCommand).length).toBe(0);
  });

  test("Rejects a request missing its title", async () => {
    await app.ready();
    makeLeadOf("C01");
    const { title: _title, ...missingTitle } = fundingBody;
    const response = await supertest(app.server)
      .post(listUrl)
      .set("authorization", `Bearer ${jwtFor(LEAD)}`)
      .send(missingTitle);
    expect(response.statusCode).toBe(400);
  });

  test("Rejects a non-integer amount", async () => {
    await app.ready();
    makeLeadOf("C01");
    const response = await supertest(app.server)
      .post(listUrl)
      .set("authorization", `Bearer ${jwtFor(LEAD)}`)
      .send({ ...fundingBody, requestedAmountCents: 12.5 });
    expect(response.statusCode).toBe(400);
  });

  test("Creates a funding request", async () => {
    await app.ready();
    makeLeadOf("C01");
    ddbMock.on(TransactWriteItemsCommand).resolves({});

    const response = await supertest(app.server)
      .post(listUrl)
      .set("authorization", `Bearer ${jwtFor(LEAD)}`)
      .send(fundingBody);

    expect(response.statusCode).toBe(201);
    expect(response.body.status).toBe(FundingRequestStatus.SUBMITTED);
    const requestId = response.body.id;
    expect(requestId).toBeTruthy();

    const items = sentItems();
    const main = items[0].Put!;
    expect(main.TableName).toBe(genericConfig.FundingRequestsTableName);
    const mainRow = unmarshall(main.Item!);
    expect(mainRow).toMatchObject({
      semesterId: "fa26",
      "orgId#requestId": `C01#${requestId}`,
      requestId,
      currentStatus: FundingRequestStatus.SUBMITTED,
      createdBy: LEAD,
      requestedAmountCents: 45000,
    });
    expect(mainRow.expiresAt).toBeGreaterThan(Date.now() / 1000);

    const history = items[1].Put!;
    expect(history.TableName).toBe(
      genericConfig.FundingRequestsStatusTableName,
    );
    expect(unmarshall(history.Item!)).toMatchObject({
      requestId,
      status: FundingRequestStatus.SUBMITTED,
      semesterId: "fa26",
    });
  });

  test("Saves exactly the main table's columns, ignoring extra fields", async () => {
    await app.ready();
    makeLeadOf("C01");
    ddbMock.on(TransactWriteItemsCommand).resolves({});

    const response = await supertest(app.server)
      .post(listUrl)
      .set("authorization", `Bearer ${jwtFor(LEAD)}`)
      .send({
        ...fundingBody,
        vendor: "Papa Del's",
        currentStatus: "approved",
        approvedAmountCents: 999999,
      });

    expect(response.statusCode).toBe(201);
    const mainRow = unmarshall(sentItems()[0].Put!.Item!);
    expect(Object.keys(mainRow).sort()).toEqual([...mainTableColumns].sort());
    expect(mainRow.currentStatus).toBe(FundingRequestStatus.SUBMITTED);
  });

  test("A request created here shows up in the list endpoint", async () => {
    await app.ready();
    makeLeadOf("C01");
    ddbMock.on(TransactWriteItemsCommand).resolves({});
    const created = await supertest(app.server)
      .post(listUrl)
      .set("authorization", `Bearer ${jwtFor(LEAD)}`)
      .send(fundingBody);
    expect(created.statusCode).toBe(201);

    // Feed the exact row POST wrote back through GET.
    const savedRow = sentItems()[0].Put!.Item!;
    ddbMock.on(QueryCommand).resolves({ Items: [savedRow] });
    const listed = await supertest(app.server)
      .get(listUrl)
      .query({ semesterId: "fa26" })
      .set("authorization", `Bearer ${jwtFor(LEAD)}`);

    expect(listed.statusCode).toBe(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0]).toMatchObject({
      requestId: created.body.id,
      orgId: "C01",
      title: "Hackathon pizza",
      requestedAmountCents: 45000,
      status: FundingRequestStatus.SUBMITTED,
    });
  });

  test("Returns 500 when the database write fails", async () => {
    await app.ready();
    makeLeadOf("C01");
    ddbMock.on(TransactWriteItemsCommand).rejects(new Error("ddb down"));

    const response = await supertest(app.server)
      .post(listUrl)
      .set("authorization", `Bearer ${jwtFor(LEAD)}`)
      .send(fundingBody);

    expect(response.statusCode).toBe(500);
  });
});
