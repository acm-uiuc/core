import { afterAll, expect, test, beforeEach, vi } from "vitest";
import init from "../../src/api/server.js";
import { createJwt } from "./auth.test.js";
import { secretObject } from "./secret.testdata.js";
import supertest from "supertest";
import { describe } from "node:test";

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
import { EntraInvitationError } from "../../src/common/errors/index.js";

const jwt_secret = secretObject["jwt_key"];

vi.stubEnv("JwtSigningKey", jwt_secret);

const app = await init();

describe("Test Microsoft Entra ID user invitation", () => {
  test("Emails must end in @illinois.edu.", async () => {
    const testJwt = createJwt();
    await app.ready();

    const response = await supertest(app.server)
      .post("/api/v1/iam/inviteUsers")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        emails: ["someone@testing.acmuiuc.org"],
      });
    expect(response.statusCode).toBe(202);
    expect(response.body.success.length).toEqual(0);
    expect(response.body.failure.length).toEqual(1);
    expect(getEntraIdToken).toHaveBeenCalled();
    expect(addToTenant).toHaveBeenCalled();
  });
  test("Happy path", async () => {
    const testJwt = createJwt();
    await app.ready();

    const response = await supertest(app.server)
      .post("/api/v1/iam/inviteUsers")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        emails: ["someone@illinois.edu"],
      });
    expect(response.statusCode).toBe(202);
    expect(getEntraIdToken).toHaveBeenCalled();
    expect(addToTenant).toHaveBeenCalled();
  });
  test("Happy path", async () => {
    const testJwt = createJwt();
    await app.ready();

    const response = await supertest(app.server)
      .post("/api/v1/iam/inviteUsers")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        emails: ["someone@illinois.edu"],
      });
    expect(response.statusCode).toBe(202);
    expect(getEntraIdToken).toHaveBeenCalled();
    expect(addToTenant).toHaveBeenCalled();
  });
  afterAll(async () => {
    await app.close();
    vi.useRealTimers();
  });

  beforeEach(() => {
    (app as any).redisClient.flushall();
    vi.clearAllMocks();
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
