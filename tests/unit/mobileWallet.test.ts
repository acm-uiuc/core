import { afterAll, expect, test, beforeEach, vi } from "vitest";
import { SendRawEmailCommand, SESClient } from "@aws-sdk/client-ses";
import { mockClient } from "aws-sdk-client-mock";
import { secretObject } from "./secret.testdata.js";
import init from "../../src/api/index.js";
import { describe } from "node:test";
import { EntraFetchError } from "../../src/common/errors/index.js";

const sesMock = mockClient(SESClient);
const jwt_secret = secretObject["jwt_key"];
vi.stubEnv("JwtSigningKey", jwt_secret);

vi.mock("../../src/api/functions/membership.js", () => {
  return {
    checkPaidMembership: vi.fn(
      (_endpoint: string, _log: any, netId: string) => {
        if (netId === "valid") {
          return true;
        }
        return false;
      },
    ),
  };
});

vi.mock("../../src/api/functions/entraId.js", () => {
  return {
    getEntraIdToken: vi.fn().mockImplementation(async () => {
      return "atokenofalltime";
    }),
    getUserProfile: vi
      .fn()
      .mockImplementation(async (_token: string, email: string) => {
        if (email === "valid@illinois.edu") {
          return { displayName: "John Doe" };
        }
        throw new EntraFetchError({
          message: "User not found",
          email,
        });
      }),
    resolveEmailToOid: vi.fn().mockImplementation(async () => {
      return "12345";
    }),
  };
});

vi.mock("../../src/api/functions/mobileWallet.js", () => {
  return {
    issueAppleWalletMembershipCard: vi.fn().mockImplementation(async () => {
      return new ArrayBuffer();
    }),
  };
});

const app = await init();
describe("Mobile wallet pass issuance", async () => {
  test("Test that passes will not be issued for non-emails", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/mobileWallet/membership?email=notanemail",
    });
    expect(response.statusCode).toBe(400);
    await response.json();
  });
  test("Test that passes will not be issued for non-members", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/mobileWallet/membership?email=notamember@illinois.edu",
    });
    expect(response.statusCode).toBe(403);
    await response.json();
  });
  test("Test that passes will be issued for members", async () => {
    sesMock.on(SendRawEmailCommand).resolves({});
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/mobileWallet/membership?email=valid@illinois.edu",
    });
    expect(response.statusCode).toBe(202);
    expect();
  });
  test("Test that SES errors result in a server error", async () => {
    sesMock.on(SendRawEmailCommand).rejects({});
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/mobileWallet/membership?email=valid@illinois.edu",
    });
    expect(response.statusCode).toBe(500);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    (app as any).nodeCache.flushAll();
    vi.clearAllMocks();
  });
});
