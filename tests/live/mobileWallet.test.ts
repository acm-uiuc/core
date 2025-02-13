import { expect, test, describe } from "vitest";

const baseEndpoint = `https://infra-core-api.aws.qa.acmuiuc.org`;

describe("Mobile pass issuance", async () => {
  test(
    "Test that passes will not be issued for non-members",
    { timeout: 10000 },
    async () => {
      const response = await fetch(
        `${baseEndpoint}/api/v1/mobileWallet/membership?email=notamemberatall@illinois.edu`,
        { method: "POST" },
      );
      expect(response.status).toBe(403);
    },
  );
  test(
    "Test that passes will be issued for members",
    { timeout: 10000 },
    async () => {
      const response = await fetch(
        `${baseEndpoint}/api/v1/mobileWallet/membership?email=testinguser@illinois.edu`,
        { method: "POST" },
      );
      expect(response.status).toBe(202);
    },
  );
});
