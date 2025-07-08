import { describe, expect, test } from "vitest";
import { createJwt, getBaseEndpoint } from "./utils.js";
import { allAppRoles } from "../../src/common/roles.js";

const baseEndpoint = getBaseEndpoint();

describe("Session clearing tests", async () => {
  test("Token is revoked on logout", async () => {
    const token = await createJwt();
    // token works
    const response = await fetch(`${baseEndpoint}/api/v1/protected`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    expect(response.status).toBe(200);
    const responseBody = await response.json();
    expect(responseBody).toStrictEqual({
      username: "infra@acm.illinois.edu",
      roles: allAppRoles,
    });
    // user logs out
    const clearResponse = await fetch(`${baseEndpoint}/api/v1/clearSession`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    expect(clearResponse.status).toBe(201);
    // token should be revoked
    const responseFail = await fetch(`${baseEndpoint}/api/v1/protected`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    expect(responseFail.status).toBe(403);
  });
});
