import { expect, test, describe } from "vitest";
import { createJwt } from "./utils.js";
import { getBaseEndpoint } from "./utils.js";

const baseEndpoint = getBaseEndpoint();

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
  test(
    "Test that getting user purchases succeeds",
    { timeout: 10000 },
    async () => {
      const response = await fetch(
        `${baseEndpoint}/api/v1/tickets/purchases/acm@illinois.edu`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      expect(response.status).toBe(200);
      const responseBody = await response.json();
      expect(responseBody).toHaveProperty("merch");
      expect(responseBody).toHaveProperty("tickets");
      expect(Array.isArray(responseBody["merch"])).toBe(true);
      expect(Array.isArray(responseBody["tickets"])).toBe(true);
    },
  );
});
