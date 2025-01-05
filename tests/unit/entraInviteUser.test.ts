import { afterAll, expect, test, beforeEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import init from "../../src/api/index.js";
import { createJwt } from "./auth.test.js";
import { secretJson, secretObject } from "./secret.testdata.js";
import supertest from "supertest";
import { describe } from "node:test";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

vi.mock("../../src/api/functions/entraId.js", () => {
  return {
    ...vi.importActual("../../src/api/functions/entraId.js"),
    getEntraIdToken: vi.fn().mockImplementation(async () => {
      return "ey.test.token";
    }),
    addToTenant: vi.fn().mockImplementation(async (_) => {
      return { success: true, email: "testing@illinois.edu" };
    }),
  };
});

import {
  addToTenant,
  getEntraIdToken,
} from "../../src/api/functions/entraId.js";
import { EntraInvitationError } from "../../src/errors/index.js";

const smMock = mockClient(SecretsManagerClient);
const jwt_secret = secretObject["jwt_key"];

vi.stubEnv("JwtSigningKey", jwt_secret);

const app = await init();

describe("Test Microsoft Entra ID user invitation", () => {
  test("Emails must end in @illinois.edu.", async () => {
    smMock.on(GetSecretValueCommand).resolves({
      SecretString: secretJson,
    });
    const testJwt = createJwt();
    await app.ready();

    const response = await supertest(app.server)
      .post("/api/v1/iam/inviteUsers")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        emails: ["someone@testing.acmuiuc.org"],
      });
    expect(response.statusCode).toBe(500);
    expect(getEntraIdToken).toHaveBeenCalled();
    expect(addToTenant).toHaveBeenCalled();
  });
  test("Happy path", async () => {
    smMock.on(GetSecretValueCommand).resolves({
      SecretString: secretJson,
    });
    const testJwt = createJwt();
    await app.ready();

    const response = await supertest(app.server)
      .post("/api/v1/iam/inviteUsers")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        emails: ["someone@illinois.edu"],
      });
    expect(response.statusCode).toBe(201);
    expect(getEntraIdToken).toHaveBeenCalled();
    expect(addToTenant).toHaveBeenCalled();
  });
  test("Happy path", async () => {
    smMock.on(GetSecretValueCommand).resolves({
      SecretString: secretJson,
    });
    const testJwt = createJwt();
    await app.ready();

    const response = await supertest(app.server)
      .post("/api/v1/iam/inviteUsers")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        emails: ["someone@illinois.edu"],
      });
    expect(response.statusCode).toBe(201);
    expect(getEntraIdToken).toHaveBeenCalled();
    expect(addToTenant).toHaveBeenCalled();
  });
  afterAll(async () => {
    await app.close();
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    // Re-implement the mock
    (getEntraIdToken as any).mockImplementation(async () => {
      return "ey.test.token";
    });
    (addToTenant as any).mockImplementation(
      async (token: string, email: string) => {
        email = email.toLowerCase().replace(/\s/g, "");
        if (!email.endsWith("@illinois.edu")) {
          throw new EntraInvitationError({
            email,
            message: "User's domain must be illinois.edu to be invited.",
          });
        }
        return { success: true, email: "testing@illinois.edu" };
      },
    );
  });
});
