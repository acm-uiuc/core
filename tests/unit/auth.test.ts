import { expect, test, vi } from "vitest";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { mockClient } from "aws-sdk-client-mock";
import init from "../../src/api/index.js";
import {
  secretJson,
  secretObject,
  jwtPayload,
  jwtPayloadNoGroups,
} from "./secret.testdata.js";
import jwt from "jsonwebtoken";
import { allAppRoles, AppRoles } from "../../src/common/roles.js";
import { beforeEach, describe } from "node:test";

const ddbMock = mockClient(SecretsManagerClient);

const app = await init();
const jwt_secret = secretObject["jwt_key"];
export function createJwt(date?: Date, group?: string, email?: string) {
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

  if (group) {
    modifiedPayload.groups = [group];
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
    ddbMock.on(GetSecretValueCommand).resolves({
      SecretString: secretJson,
    });
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
    });
  });

  test("Test user-specific role grants", async () => {
    ddbMock.on(GetSecretValueCommand).resolves({
      SecretString: secretJson,
    });
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
    });
  });

  beforeEach(() => {
    (app as any).nodeCache.flushAll();
  });
});
