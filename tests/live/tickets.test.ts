import { expect, test, describe } from "vitest";
import { createJwt } from "./utils";

const baseEndpoint = `https://core.aws.qa.acmuiuc.org`;

describe("Tickets live API tests", async () => {
  const token = await createJwt();
  test(
    "Test that auth is present on the GET route",
    { timeout: 10000 },
    async () => {
      const response = await fetch(`${baseEndpoint}/api/v1/tickets/`, {
        method: "GET",
      });
      expect(response.status).toBe(403);
    },
  );
  test("Test that getting metadata succeeds", { timeout: 10000 }, async () => {
    const response = await fetch(`${baseEndpoint}/api/v1/tickets`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    expect(response.status).toBe(200);
    const responseBody = await response.json();
    expect(responseBody).toHaveProperty("merch");
    expect(responseBody).toHaveProperty("tickets");
    expect(Array.isArray(responseBody["merch"])).toBe(true);
    expect(Array.isArray(responseBody["tickets"])).toBe(true);
  });
});
