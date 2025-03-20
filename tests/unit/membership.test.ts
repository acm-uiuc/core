import { afterAll, expect, test, vi } from "vitest";
import init from "../../src/api/index.js";
import { EventGetResponse } from "../../src/api/routes/events.js";
import { describe } from "node:test";
import { setPaidMembershipInTable } from "../../src/api/functions/membership.js";

const app = await init();
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
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/membership/eadon2",
    });

    expect(response.statusCode).toBe(200);
    const responseDataJson = (await response.json()) as EventGetResponse;
    expect(response.headers).toHaveProperty("x-acm-data-source");
    expect(response.headers["x-acm-data-source"]).toEqual("aad");
    expect(responseDataJson).toEqual({ netId: "eadon2", isPaidMember: true });
    expect(spySetPaidMembership).toHaveBeenCalledWith(
      "eadon2",
      expect.any(Object),
    );
  });

  afterAll(async () => {
    await app.close();
  });
});
