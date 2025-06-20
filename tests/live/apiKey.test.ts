import { expect, test, describe } from "vitest";
import { getBaseEndpoint } from "./utils.js";

const baseEndpoint = getBaseEndpoint();

describe("API Key tests", async () => {
  test("Test that auth is present on routes", { timeout: 10000 }, async () => {
    const response = await fetch(`${baseEndpoint}/api/v1/apiKey/org`, {
      method: "GET",
    });
    expect(response.status).toBe(403);
    const responsePost = await fetch(`${baseEndpoint}/api/v1/apiKey/org`, {
      method: "POST",
    });
    expect(responsePost.status).toBe(403);
  });
});
