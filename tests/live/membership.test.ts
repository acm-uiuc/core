import { expect, test, describe } from "vitest";
import { getBaseEndpoint } from "./utils.js";

const baseEndpoint = getBaseEndpoint();

describe("Membership API basic checks", async () => {
  test("Test that getting member succeeds", { timeout: 3000 }, async () => {
    const response = await fetch(`${baseEndpoint}/api/v1/membership/dsingh14`, {
      method: "GET",
    });

    expect(response.status).toBe(200);

    const responseBody = await response.json();
    expect(responseBody).toStrictEqual({
      netId: "dsingh14",
      isPaidMember: true,
    });

    const wasCached = (value: string | null) => value && value !== "aad";

    expect(wasCached(response.headers.get("x-acm-data-source"))).toBe(true);
  });
  test(
    "Test that getting member with non-standard casing succeeds",
    { timeout: 3000 },
    async () => {
      const response = await fetch(
        `${baseEndpoint}/api/v1/membership/DSingh14`,
        {
          method: "GET",
        },
      );

      expect(response.status).toBe(200);

      const responseBody = await response.json();
      expect(responseBody).toStrictEqual({
        netId: "dsingh14",
        isPaidMember: true,
      });

      const wasCached = (value: string | null) => value && value !== "aad";

      expect(wasCached(response.headers.get("x-acm-data-source"))).toBe(true);
    },
  );
  test(
    "Test that getting non-members succeeds",
    { timeout: 3000 },
    async () => {
      const response = await fetch(`${baseEndpoint}/api/v1/membership/zzzz`, {
        method: "GET",
      });

      expect(response.status).toBe(200);

      const responseBody = await response.json();
      expect(responseBody).toStrictEqual({
        netId: "zzzz",
        isPaidMember: false,
      });
    },
  );
  test("Test that too long NetID is rejected", { timeout: 3000 }, async () => {
    const response = await fetch(
      `${baseEndpoint}/api/v1/membership/dsafdsfdsfsdafsfsdfasfsfsfds`,
      {
        method: "GET",
      },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("x-acm-data-source")).toBeNull();
  });
  test("Test that too short NetID is rejected", { timeout: 3000 }, async () => {
    const response = await fetch(`${baseEndpoint}/api/v1/membership/ds`, {
      method: "GET",
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("x-acm-data-source")).toBeNull();
  });
  test(
    "Test that getting external non-members succeeds",
    { timeout: 3000 },
    async () => {
      const response = await fetch(
        `${baseEndpoint}/api/v1/membership/zzzz?list=built`,
        {
          method: "GET",
        },
      );

      expect(response.status).toBe(200);

      const responseBody = await response.json();
      expect(responseBody).toStrictEqual({
        netId: "zzzz",
        list: "built",
        isPaidMember: false,
      });
    },
  );
  test(
    "Test that getting external members succeeds",
    { timeout: 3000 },
    async () => {
      const response = await fetch(
        `${baseEndpoint}/api/v1/membership/zzzz?list=acmtesting`,
        {
          method: "GET",
        },
      );

      expect(response.status).toBe(200);

      const responseBody = await response.json();
      expect(responseBody).toStrictEqual({
        netId: "zzzz",
        list: "acmtesting",
        isPaidMember: true,
      });
    },
  );
});
