import { expect, test } from "vitest";
import init from "../../src/api/server.js";
import { allAppRoles, AppRoles } from "../../src/common/roles.js";
import { beforeEach, describe } from "vitest";
import { createJwt, createJwtNoGroups } from "./utils.js";

const app = await init();

const testJwt = createJwt();
const testJwtNoGroups = createJwtNoGroups();

describe("Test authentication", () => {
  test("Test happy path", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/protected",
      headers: {
        authorization: `Bearer ${testJwt}`,
      },
    });
    expect(response.statusCode).toBe(200);
    const jsonBody = await response.json();
    expect(jsonBody).toEqual({
      username: "infra-unit-test@acm.illinois.edu",
      roles: allAppRoles,
      orgRoles: [],
    });
  });

  test("Test user-specific role grants", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/protected",
      headers: {
        authorization: `Bearer ${testJwtNoGroups}`,
      },
    });
    expect(response.statusCode).toBe(200);
    const jsonBody = await response.json();
    expect(jsonBody).toEqual({
      username: "infra-unit-test-nogrp@acm.illinois.edu",
      roles: [AppRoles.TICKETS_SCANNER],
      orgRoles: [],
    });
  });

  beforeEach(() => {
    (app as any).redisClient.flushall();
  });
});
