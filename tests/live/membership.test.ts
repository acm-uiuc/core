import { expect, test, describe } from "vitest";
import { createJwt, getBaseEndpoint } from "./utils.js";

const baseEndpoint = getBaseEndpoint();

describe("Membership API basic checks", async () => {
  test("Test that getting member succeeds", { timeout: 10000 }, async () => {
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
    { timeout: 10000 },
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
    { timeout: 10000 },
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
  test("Test that too long NetID is rejected", { timeout: 10000 }, async () => {
    const response = await fetch(
      `${baseEndpoint}/api/v1/membership/dsafdsfdsfsdafsfsdfasfsfsfds`,
      {
        method: "GET",
      },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("x-acm-data-source")).toBeNull();
  });
  test(
    "Test that too short NetID is rejected",
    { timeout: 10000 },
    async () => {
      const response = await fetch(`${baseEndpoint}/api/v1/membership/ds`, {
        method: "GET",
      });

      expect(response.status).toBe(400);
      expect(response.headers.get("x-acm-data-source")).toBeNull();
    },
  );
  test(
    "Test that getting external non-members succeeds",
    { timeout: 10000 },
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
    { timeout: 10000 },
    async () => {
      const response = await fetch(
        `${baseEndpoint}/api/v1/membership/zzzz?list=do_not_delete_acmtesting`,
        {
          method: "GET",
        },
      );

      expect(response.status).toBe(200);

      const responseBody = await response.json();
      expect(responseBody).toStrictEqual({
        netId: "zzzz",
        list: "do_not_delete_acmtesting",
        isPaidMember: true,
      });
    },
  );
  test(
    "Test that getting external lists succeeds",
    { timeout: 10000 },
    async () => {
      const token = await createJwt();
      const response = await fetch(
        `${baseEndpoint}/api/v1/membership/externalList`,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${token}`,
          },
        },
      );

      expect(response.status).toBe(200);

      const responseBody = await response.json();
      expect(responseBody.length).toBeGreaterThan(0);
    },
  );
  test(
    "Test that patching external list members succeeds",
    { timeout: 10000 },
    async () => {
      const token = await createJwt();
      const responseInit = await fetch(
        `${baseEndpoint}/api/v1/membership/externalList/acmLiveTesting`,
        {
          method: "PATCH",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            add: ["acmtest3"],
            remove: [],
          }),
        },
      );
      expect(responseInit.status).toBe(201);
      const response = await fetch(
        `${baseEndpoint}/api/v1/membership/externalList/acmLiveTesting`,
        {
          method: "PATCH",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            add: ["acmtest2"],
            remove: ["acmtest3"],
          }),
        },
      );

      expect(response.status).toBe(201);
      const response2 = await fetch(
        `${baseEndpoint}/api/v1/membership/externalList/acmLiveTesting`,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${token}`,
          },
        },
      );

      expect(response2.status).toBe(200);

      const responseBody = await response2.json();
      expect(responseBody.length).toBeGreaterThan(0);
      expect(responseBody).toContain("acmtest2");
      expect(responseBody).not.toContain("acmtest3");
    },
  );
});
