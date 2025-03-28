import { afterAll, expect, test, vi } from "vitest";
import init from "../../src/api/index.js";
import { EventGetResponse } from "../../src/api/routes/events.js";
import { afterEach, describe } from "node:test";
import { setPaidMembershipInTable } from "../../src/api/functions/membership.js";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { genericConfig } from "../../src/common/config.js";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

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
  test("Test getting member", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/membership/valid",
    });
    expect(response.statusCode).toBe(200);
    const responseDataJson = (await response.json()) as EventGetResponse;
    expect(response.headers).toHaveProperty("x-acm-data-source");
    expect(response.headers["x-acm-data-source"]).toEqual("dynamo");
    expect(responseDataJson).toEqual({ netId: "valid", isPaidMember: true });
  });

  test("Test getting non-member", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/membership/invalid",
    });
    expect(response.statusCode).toBe(200);
    const responseDataJson = (await response.json()) as EventGetResponse;
    expect(response.headers).toHaveProperty("x-acm-data-source");
    expect(response.headers["x-acm-data-source"]).toEqual("aad");
    expect(responseDataJson).toEqual({ netId: "invalid", isPaidMember: false });
  });

  test("Entra-only members are added to Dynamo", async () => {
    let response = await app.inject({
      method: "GET",
      url: "/api/v1/membership/eadon2",
    });

    expect(response.statusCode).toBe(200);
    let responseDataJson = (await response.json()) as EventGetResponse;
    expect(response.headers).toHaveProperty("x-acm-data-source");
    expect(response.headers["x-acm-data-source"]).toEqual("aad");
    expect(responseDataJson).toEqual({ netId: "eadon2", isPaidMember: true });
    expect(spySetPaidMembership).toHaveBeenCalledWith(
      "eadon2",
      expect.any(Object),
    );
    response = await app.inject({
      method: "GET",
      url: "/api/v1/membership/eadon2",
    });
    expect(response.statusCode).toBe(200);
    responseDataJson = (await response.json()) as EventGetResponse;
    expect(response.headers).toHaveProperty("x-acm-data-source");
    expect(response.headers["x-acm-data-source"]).toEqual("cache");
    expect(responseDataJson).toEqual({ netId: "eadon2", isPaidMember: true });
  });
  test("External list members are correctly found", async () => {
    ddbMock.on(QueryCommand).callsFake((command) => {
      if (command.TableName === genericConfig.ExternalMembershipTableName) {
        const requestedEmail = command.ExpressionAttributeValues[":pk"].S;
        const mockMembershipData = {
          eadon2_built: { netid_list: "eadon2_built" },
          yourm4_wcs: { netid_list: "yourm4_wcs" },
        };

        return Promise.resolve({
          Items: mockMembershipData[requestedEmail]
            ? [marshall(mockMembershipData[requestedEmail])]
            : [],
        });
      }
      return Promise.reject(new Error("Table not mocked"));
    });
    let response = await app.inject({
      method: "GET",
      url: "/api/v1/membership/eadon2?list=built",
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
      url: "/api/v1/membership/eadon2?list=wcs",
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
      url: "/api/v1/membership/yourm4?list=wcs",
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
      url: "/api/v1/membership/eadon2?list=wcs",
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
      url: "/api/v1/membership/eadon2?list=built",
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
  afterEach(async () => {
    ddbMock.reset();
  });
  afterAll(async () => {
    await app.close();
  });
});
