import { afterAll, expect, test, beforeEach, vi, describe } from "vitest";
import init from "../../src/api/index.js";
import { EntraFetchError } from "../../src/common/errors/index.js";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { mockClient } from "aws-sdk-client-mock";
import { secretJson } from "./secret.testdata.js";

const smMock = mockClient(SecretsManagerClient);
const sqsMock = mockClient(SQSClient);

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
      method: "POST",
      url: "/api/v1/mobileWallet/membership?email=notanemail",
    });
    expect(response.statusCode).toBe(400);
    await response.json();
  });
  test("Test that passes will not be issued for non-members", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/mobileWallet/membership?email=notamember@illinois.edu",
    });
    expect(response.statusCode).toBe(403);
    await response.json();
  });
  test("Test that passes will be issued for members", async () => {
    sqsMock.on(SendMessageCommand).resolvesOnce({});
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/mobileWallet/membership?email=valid@illinois.edu",
    });
    expect(sqsMock.calls.length).toBe(1);
    expect(response.statusCode).toBe(202);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    (app as any).nodeCache.flushAll();
    vi.clearAllMocks();
    smMock.on(GetSecretValueCommand).resolves({
      SecretString: secretJson,
    });
  });
});
