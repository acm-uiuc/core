import { afterAll, expect, test, vi } from "vitest";
import init from "../../src/api/index.js";
import { EventGetResponse } from "../../src/api/routes/events.js";
import { afterEach, describe } from "node:test";
import { setPaidMembershipInTable } from "../../src/api/functions/membership.js";
import {
  BatchGetItemCommand,
  BatchWriteItemCommand,
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { genericConfig } from "../../src/common/config.js";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { createJwt } from "./auth.test.js";

const app = await init();
const ddbMock = mockClient(DynamoDBClient);

vi.mock("../../src/api/functions/entraId.js", () => {
  return {
    ...vi.importActual("../../src/api/functions/entraId.js"),
    getEntraIdToken: vi.fn().mockImplementation(async () => ""),
    modifyGroup: vi.fn().mockImplementation(async () => ""),
    resolveEmailToOid: vi.fn().mockImplementation(async () => ""),
    listGroupMembers: vi.fn().mockImplementation(async () => ""),
  };
});

const spySetPaidMembership = vi.spyOn(
  await import("../../src/api/functions/membership.js"),
  "setPaidMembershipInTable",
);

describe("Test membership routes", async () => {
  test("Test getting non-member with UIUC access token", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/membership",
      headers: {
        "x-uiuc-token":
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEsImlhdCI6MTY3Mjc2NjAyOCwiZXhwIjoxNjc0NDk0MDI4fQ.kCak9sLJr74frSRVQp0_27BY4iBCgQSmoT3vQVWKzJg",
      },
    });
    expect(response.statusCode).toBe(200);
    const responseDataJson = (await response.json()) as EventGetResponse;
    expect(response.headers).toHaveProperty("x-acm-data-source");
    expect(response.headers["x-acm-data-source"]).toEqual("dynamo");
    expect(responseDataJson).toEqual({
      givenName: "Infra",
      surname: "Testing",
      netId: "fjkldk99",
      isPaidMember: false,
    });
  });
  test("Test getting member with UIUC access token", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/membership",
      headers: {
        "x-uiuc-token":
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEsImlhdCI6MTY3Mjc2NjAyOCwiZXhwIjoxNjcyODAyMDI4fQ.P1_rB3hJ5afwiG4TWXLq6jOAcVJkvQZ2Z-ZZOnQ1dZw",
      },
    });
    expect(response.statusCode).toBe(200);
    const responseDataJson = (await response.json()) as EventGetResponse;
    expect(response.headers).toHaveProperty("x-acm-data-source");
    expect(response.headers["x-acm-data-source"]).toEqual("dynamo");
    expect(responseDataJson).toEqual({
      givenName: "Infra",
      surname: "Testing",
      netId: "valid",
      isPaidMember: true,
    });
  });

  test("Test getting non-member", async () => {
    const testJwt = createJwt();
    const response = await app.inject({
      method: "GET",
      url: "/api/v2/membership/invalid",
      headers: {
        authorization: `Bearer ${testJwt}`,
      },
    });
    expect(response.statusCode).toBe(200);
    const responseDataJson = (await response.json()) as EventGetResponse;
    expect(response.headers).toHaveProperty("x-acm-data-source");
    expect(response.headers["x-acm-data-source"]).toEqual("dynamo");
    expect(responseDataJson).toEqual({ netId: "invalid", isPaidMember: false });
  });

  test("External list members are correctly found", async () => {
    ddbMock.on(QueryCommand).callsFake((command) => {
      if (
        command.TableName === genericConfig.ExternalMembershipTableName &&
        command.IndexName === "invertedIndex"
      ) {
        const requestedEmail = command.ExpressionAttributeValues[":pk"].S;
        const requestedList = command.ExpressionAttributeValues[":sk"].S;
        const requestedKey = `${requestedEmail}_${requestedList}`;
        const mockMembershipData = {
          eadon2_built: { netId: "eadon2", list: "built" },
          yourm4_wcs: { netId: "yourm4", list: "wcs" },
        };

        return Promise.resolve({
          Items:
            requestedKey in mockMembershipData
              ? [
                  marshall(
                    mockMembershipData[
                      requestedKey as keyof typeof mockMembershipData
                    ],
                  ),
                ]
              : [],
        });
      }
      return Promise.reject(new Error("Table not mocked"));
    });
    const testJwt = createJwt();
    let response = await app.inject({
      method: "GET",
      url: "/api/v2/membership/eadon2?list=built",
      headers: {
        authorization: `Bearer ${testJwt}`,
      },
    });

    expect(response.statusCode).toBe(200);
    let responseDataJson = (await response.json()) as EventGetResponse;
    expect(response.headers).toHaveProperty("x-acm-data-source");
    expect(response.headers["x-acm-data-source"]).toEqual("dynamo");
    expect(responseDataJson).toEqual({
      netId: "eadon2",
      list: "built",
      isPaidMember: true,
    });
    response = await app.inject({
      method: "GET",
      url: "/api/v2/membership/eadon2?list=wcs",
      headers: {
        authorization: `Bearer ${testJwt}`,
      },
    });
    expect(response.statusCode).toBe(200);
    responseDataJson = (await response.json()) as EventGetResponse;
    expect(response.headers).toHaveProperty("x-acm-data-source");
    expect(response.headers["x-acm-data-source"]).toEqual("dynamo");
    expect(responseDataJson).toEqual({
      netId: "eadon2",
      list: "wcs",
      isPaidMember: false,
    });
    response = await app.inject({
      method: "GET",
      url: "/api/v2/membership/yourm4?list=wcs",
      headers: {
        authorization: `Bearer ${testJwt}`,
      },
    });
    expect(response.statusCode).toBe(200);
    responseDataJson = (await response.json()) as EventGetResponse;
    expect(response.headers).toHaveProperty("x-acm-data-source");
    expect(response.headers["x-acm-data-source"]).toEqual("dynamo");
    expect(responseDataJson).toEqual({
      netId: "yourm4",
      list: "wcs",
      isPaidMember: true,
    });
    response = await app.inject({
      method: "GET",
      url: "/api/v2/membership/eadon2?list=wcs",
      headers: {
        authorization: `Bearer ${testJwt}`,
      },
    });
    expect(response.statusCode).toBe(200);
    responseDataJson = (await response.json()) as EventGetResponse;
    expect(response.headers).toHaveProperty("x-acm-data-source");
    expect(response.headers["x-acm-data-source"]).toEqual("cache");
    expect(responseDataJson).toEqual({
      netId: "eadon2",
      list: "wcs",
      isPaidMember: false,
    });
    response = await app.inject({
      method: "GET",
      url: "/api/v2/membership/eadon2?list=built",
      headers: {
        authorization: `Bearer ${testJwt}`,
      },
    });
    expect(response.statusCode).toBe(200);
    responseDataJson = (await response.json()) as EventGetResponse;
    expect(response.headers).toHaveProperty("x-acm-data-source");
    expect(response.headers["x-acm-data-source"]).toEqual("cache");
    expect(responseDataJson).toEqual({
      netId: "eadon2",
      list: "built",
      isPaidMember: true,
    });
  });
  test("External lists are correctly found", async () => {
    const adminJwt = createJwt();
    ddbMock.on(ScanCommand).callsFake((command) => {
      if (
        command.TableName === genericConfig.ExternalMembershipTableName &&
        command.IndexName === "keysOnlyIndex"
      ) {
        return Promise.resolve({
          Items: [{ memberList: { S: "acmUnitTesting" } }],
        });
      }
      return Promise.reject(
        new Error("Table not mocked or not called correctly"),
      );
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/membership/externalList",
      headers: {
        authorization: `Bearer ${adminJwt}`,
      },
    });
    expect(response.statusCode).toBe(200);
    const json = await response.json();
    expect(json).toStrictEqual(["acmUnitTesting"]);
  });
  test("External list members are correctly patched", async () => {
    const adminJwt = createJwt();
    ddbMock.on(BatchWriteItemCommand).callsFake((command) => {
      if (
        (command.RequestItems = {
          [genericConfig.ExternalMembershipTableName]: [
            {
              PutRequest: {
                Item: {
                  memberList: { S: "acmUnitTesting" },
                  netId: { S: "acmtest2" },
                },
              },
            },
            {
              DeleteRequest: {
                Item: {
                  memberList: { S: "acmUnitTesting" },
                  netId: { S: "acmtest3" },
                },
              },
            },
          ],
        })
      ) {
        return Promise.resolve({});
      }
      return Promise.reject(
        new Error("Table not mocked or not called correctly"),
      );
    });
    let response = await app.inject({
      method: "PATCH",
      url: "/api/v1/membership/externalList/acmUnitTesting",
      headers: {
        authorization: `Bearer ${adminJwt}`,
      },
      body: {
        add: ["acmtest2"],
        remove: ["acmtest3"],
      },
    });
    expect(response.statusCode).toBe(201);
  });
  test("Test getting members/non-members in batch.", async () => {
    ddbMock.on(BatchGetItemCommand).resolvesOnce({
      Responses: {
        [genericConfig.UserInfoTable]: [
          marshall({
            id: "valid@illinois.edu",
            isPaidMember: true,
          }),
        ],
      },
    });
    const testJwt = createJwt();
    const response = await app.inject({
      method: "POST",
      url: "/api/v2/membership/verifyBatchOfMembers",
      headers: {
        authorization: `Bearer ${testJwt}`,
      },
      body: ["valid", "invalid"],
    });
    expect(response.statusCode).toBe(200);
    const responseDataJson = (await response.json()) as EventGetResponse;
    expect(responseDataJson).toEqual({
      members: ["valid"],
      notMembers: ["invalid"],
    });
  });
  afterEach(async () => {
    ddbMock.reset();
  });
  afterAll(async () => {
    await app.close();
  });
});
