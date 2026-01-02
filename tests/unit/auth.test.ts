import { expect, test, vi } from "vitest";
import init from "../../src/api/index.js";
import {
  secretObject,
  jwtPayload,
  jwtPayloadNoGroups,
  secretObject,
} from "./secret.testdata.js";
import jwt from "jsonwebtoken";
import { allAppRoles, AppRoles } from "../../src/common/roles.js";
import { beforeEach, describe } from "node:test";

const app = await init();
const jwt_secret = secretObject["jwt_key"];
export function createJwt(date?: Date, groups?: string[], email?: string) {
  let modifiedPayload = {
    ...jwtPayload,
    email: email || jwtPayload.email,
    groups: [...jwtPayload.groups],
  };
  if (date) {
    const nowMs = Math.floor(date.valueOf() / 1000);
    const laterMs = nowMs + 3600 * 24;
    modifiedPayload = {
      ...modifiedPayload,
      iat: nowMs,
      nbf: nowMs,
      exp: laterMs,
    };
  }

  if (groups) {
    modifiedPayload.groups = groups;
  }
  return jwt.sign(modifiedPayload, jwt_secret, { algorithm: "HS256" });
}

export function createJwtNoGroups() {
  const modifiedPayload = jwtPayloadNoGroups;
  return jwt.sign(modifiedPayload, jwt_secret, { algorithm: "HS256" });
}

vi.stubEnv("JwtSigningKey", jwt_secret);

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
    (app as any).nodeCache.flushAll();
    (app as any).redisClient.flushAll();
  });
});
