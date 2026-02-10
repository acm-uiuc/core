import { expect, test, describe } from "vitest";
import { createJwt } from "./utils.js";
import { allAppRoles } from "../../src/common/roles.js";
import { getBaseEndpoint } from "./utils.js";

const baseEndpoint = getBaseEndpoint();

describe("Role checking live API tests", async () => {
  const token = await createJwt();
  test(
    "Test that auth is present on the GET route",
    { timeout: 10000 },
    async () => {
      const response = await fetch(`${baseEndpoint}/api/v1/protected`, {
        method: "GET",
      });
      expect(response.status).toBe(401);
    },
  );
  test("Test that getting metadata succeeds", { timeout: 10000 }, async () => {
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
      orgRoles: [],
    });
  });
});
