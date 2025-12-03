import { describe, expect, test } from "vitest";
import { createJwt, getBaseEndpoint } from "./utils.js";

const baseEndpoint = getBaseEndpoint();
const token = await createJwt();

describe("Audit log get tests", async () => {
  test("Getting the audit log succeeds", async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).getTime();
    const now = new Date().getTime();

    const path = `${baseEndpoint}/api/v1/logs/iam/?start=${oneHourAgo}&end=${now}`;
    const response = await fetch(path, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    expect(response.status).toEqual(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
