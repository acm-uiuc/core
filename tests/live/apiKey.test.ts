import { expect, test, describe } from "vitest";

const baseEndpoint = `https://core.aws.qa.acmuiuc.org`;

describe("API Key tests", async () => {
  test("Test that auth is present on routes", { timeout: 10000 }, async () => {
    const response = await fetch(`${baseEndpoint}/api/v1/apiKey/orgs`, {
      method: "GET",
    });
    expect(response.status).toBe(403);
    const responsePost = await fetch(`${baseEndpoint}/api/v1/apiKey/orgs`, {
      method: "POST",
    });
    expect(response.status).toBe(403);
  });
});
