import { expect, test, describe } from "vitest";
import { createJwt, getBaseEndpoint } from "./utils.js";

const baseEndpoint = getBaseEndpoint();
const token = await createJwt();

describe("Membership API basic checks", async () => {
  test("Test that auth is present", { timeout: 10000 }, async () => {
    const response = await fetch(`${baseEndpoint}/api/v2/membership/dsingh14`, {
      method: "GET",
    });

    expect(response.status).toBe(403);
  });
  test("Test that getting member succeeds", { timeout: 10000 }, async () => {
    const response = await fetch(`${baseEndpoint}/api/v2/membership/dsingh14`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
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
        `${baseEndpoint}/api/v2/membership/DSingh14`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      expect(response.status).toBe(200);

      const responseBody = await response.json();
      expect(responseBody).toStrictEqual({
        netId: "dsingh14",
        isPaidMember: true,
      });

      const wasCached = (value: string | null) => value && value !== "dynamo";

      expect(wasCached(response.headers.get("x-acm-data-source"))).toBe(true);
    },
  );
  test(
    "Test that getting non-members succeeds",
    { timeout: 10000 },
    async () => {
      const response = await fetch(`${baseEndpoint}/api/v2/membership/zzzz`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
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
      `${baseEndpoint}/api/v2/membership/dsafdsfdsfsdafsfsdfasfsfsfds`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("x-acm-data-source")).toBeNull();
  });
  test(
    "Test that too short NetID is rejected",
    { timeout: 10000 },
    async () => {
      const response = await fetch(`${baseEndpoint}/api/v2/membership/ds`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
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
        `${baseEndpoint}/api/v2/membership/zzzz?list=built`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
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
        `${baseEndpoint}/api/v2/membership/zzzz?list=do_not_delete_acmtesting`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
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

describe("External Membership List lifecycle", { sequential: true }, () => {
  const unixTimestampSeconds = Math.floor(Date.now() / 1000);
  const listId = `livetest-${unixTimestampSeconds}`;

  test("should create list and add initial member", async () => {
    const response = await fetch(
      `${baseEndpoint}/api/v1/membership/externalList/${listId}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          add: ["acmtest2"],
          remove: [],
        }),
      },
    );
    expect(response.status).toBe(201);
  });

  test("should retrieve list with initial member", async () => {
    const response = await fetch(
      `${baseEndpoint}/api/v1/membership/externalList/${listId}`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
      },
    );
    const responseJson = await response.json();
    expect(responseJson).toStrictEqual(["acmtest2"]);
  });

  test("should add new member and remove existing member", async () => {
    const response = await fetch(
      `${baseEndpoint}/api/v1/membership/externalList/${listId}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          add: ["acmtest3"],
          remove: ["acmtest2"],
        }),
      },
    );
    expect(response.status).toEqual(201);
  });

  test("should retrieve list with updated member", async () => {
    const response = await fetch(
      `${baseEndpoint}/api/v1/membership/externalList/${listId}`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
      },
    );
    const responseJson = await response.json();
    expect(responseJson).toStrictEqual(["acmtest3"]);
  });

  test("should remove final member", async () => {
    const response = await fetch(
      `${baseEndpoint}/api/v1/membership/externalList/${listId}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          remove: ["acmtest3"],
          add: [],
        }),
      },
    );
    expect(response.status).toEqual(201);
  });
});
