import { afterAll, expect, test, beforeEach, vi, describe } from "vitest";
import init from "../../src/api/index.js";
import { EntraFetchError } from "../../src/common/errors/index.js";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { mockClient } from "aws-sdk-client-mock";
import { v4 as uuidv4 } from "uuid";

const sqsMock = mockClient(SQSClient);

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
    const queueId = uuidv4();
    sqsMock.on(SendMessageCommand).resolves({ MessageId: queueId });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/mobileWallet/membership?email=valid@illinois.edu",
    });
    expect(response.statusCode).toBe(202);
    const body = await response.json();
    expect(body).toEqual({ queueId });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    (app as any).nodeCache.flushAll();
    vi.clearAllMocks();
  });
});
