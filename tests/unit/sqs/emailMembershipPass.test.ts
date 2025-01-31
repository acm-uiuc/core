import { expect, test, beforeEach, vi } from "vitest";
vi.mock("../../../src/api/functions/mobileWallet.js", () => ({
  issueAppleWalletMembershipCard: vi.fn().mockResolvedValue(new ArrayBuffer()),
}))

vi.mock("../../../src/api/functions/entraId.js", () => ({
  getEntraIdToken: vi.fn().mockResolvedValue("atokenofalltime"),
  getUserProfile: vi.fn().mockImplementation(async (_token: string, email: string) => {
    console.log('getUserProfile called with:', email);
    if (email === "valid@illinois.edu") {
      return { displayName: "John Doe" };
    }
    throw new EntraFetchError({
      message: "User not found",
      email,
    });
  }),
  resolveEmailToOid: vi.fn().mockResolvedValue("12345"),
}));

vi.mock("../../api/functions/mobileWallet.js", () => ({
  issueAppleWalletMembershipCard: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
}));

vi.stubEnv("RunEnvironment", 'dev');

import { describe } from "node:test";
import { emailMembershipPassHandler } from "../../../src/api/sqs/handlers.js";
import { EntraFetchError } from "../../../src/common/errors/index.js";
import { getEntraIdToken, getUserProfile } from "../../../src/api/functions/entraId.js";
import { issueAppleWalletMembershipCard } from "../../../src/api/functions/mobileWallet.js";

describe("Mobile wallet pass issuance (SQS function)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("Test that passes will be issued for members", async () => {
    const email = 'valid@illinois.edu';
    const logger = { info: vi.fn() } as any;
    await emailMembershipPassHandler(
      { email },
      { reqId: '1', initiator: '1' },
      logger
    );
    expect(getEntraIdToken).toHaveBeenCalled();
    expect(issueAppleWalletMembershipCard).toHaveBeenCalledOnce();
    expect(getUserProfile).toHaveBeenCalledWith("atokenofalltime", email);
  });
});
