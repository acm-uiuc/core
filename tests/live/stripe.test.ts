import { expect, test, describe } from "vitest";
import { createJwt } from "./utils.js";
import { getBaseEndpoint } from "./utils.js";

const baseEndpoint = getBaseEndpoint();

describe("Stripe live API authentication", async () => {
  const token = await createJwt();
  test(
    "Test that auth is present on the GET route",
    { timeout: 10000 },
    async () => {
      const response = await fetch(
        `${baseEndpoint}/api/v1/stripe/paymentLinks`,
        { method: "GET" },
      );
      expect(response.status).toBe(403);
    },
  );
  test(
    "Test that auth is present on the POST route",
    { timeout: 10000 },
    async () => {
      const response = await fetch(
        `${baseEndpoint}/api/v1/stripe/paymentLinks`,
        { method: "POST" },
      );
      expect(response.status).toBe(403);
    },
  );
  test(
    "Test that getting existing links succeeds",
    { timeout: 10000 },
    async () => {
      const response = await fetch(
        `${baseEndpoint}/api/v1/stripe/paymentLinks`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      expect(response.status).toBe(200);
    },
  );
});
