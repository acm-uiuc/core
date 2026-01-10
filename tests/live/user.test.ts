import { expect, test, describe } from "vitest";
import { createJwt } from "./utils.js";
import { getBaseEndpoint } from "./utils.js";

const baseEndpoint = getBaseEndpoint();

describe("User info live tests", async () => {
  const token = await createJwt();
  test(
    "Test that user can be looked up by UIN",
    { timeout: 10000 },
    async () => {
      const response = await fetch(
        `${baseEndpoint}/api/v1/users/findUserByUin`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            uin: "627838939",
          }),
        },
      );
      expect(response.status).toBe(200);
      const responseJson = (await response.json()) as string[];
      expect(responseJson).toEqual({
        email: "testinguser@illinois.edu",
      });
    },
  );
  test(
    "Test that invalid emails are rejected",
    { timeout: 10000 },
    async () => {
      const response = await fetch(
        `${baseEndpoint}/api/v1/users/batchResolveInfo`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            emails: ["invalid"],
          }),
        },
      );
      expect(response.status).toBe(400);
    },
  );
  test("Test that valid emails are resolved", { timeout: 10000 }, async () => {
    const response = await fetch(
      `${baseEndpoint}/api/v1/users/batchResolveInfo`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          emails: ["testinguser@illinois.edu"],
        }),
      },
    );
    expect(response.status).toBe(200);
    const responseJson = (await response.json()) as string[];
    expect(responseJson).toEqual({
      "testinguser@illinois.edu": {
        firstName: "Testing",
        lastName: "User",
      },
    });
  });
});
