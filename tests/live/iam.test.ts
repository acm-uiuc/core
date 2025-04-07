import { expect, test } from "vitest";
import { createJwt } from "./utils.js";
import {
  EntraActionResponse,
  GroupMemberGetResponse,
} from "../../src/common/types/iam.js";
import { allAppRoles, AppRoles } from "../../src/common/roles.js";

const baseEndpoint = `https://core.aws.qa.acmuiuc.org`;
test("getting members of a group", async () => {
  const token = await createJwt();
  const response = await fetch(
    `${baseEndpoint}/api/v1/iam/groups/dbe18eb2-9675-46c4-b1ef-749a6db4fedd`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );
  expect(response.status).toBe(200);
  const responseJson = (await response.json()) as GroupMemberGetResponse;
  expect(responseJson.length).greaterThan(0);
  for (const item of responseJson) {
    expect(item).toHaveProperty("name");
    expect(item).toHaveProperty("email");
    expect(item["name"].length).greaterThan(0);
    expect(item["email"].length).greaterThan(0);
    expect(item["email"]).toContain("@");
  }
});

test("inviting users to tenant", async () => {
  const token = await createJwt();
  const response = await fetch(`${baseEndpoint}/api/v1/iam/inviteUsers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      emails: ["acm@illinois.edu"],
    }),
  });
  expect(response.status).toBe(202);
  const responseJson = (await response.json()) as EntraActionResponse;
  expect(responseJson).toEqual({
    success: [{ email: "acm@illinois.edu" }],
    failure: [],
  });
});

test("getting group roles", async () => {
  const token = await createJwt();
  const response = await fetch(`${baseEndpoint}/api/v1/iam/group/0/roles`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  expect(response.status).toBe(200);
  const responseJson = (await response.json()) as AppRoles[];
  expect(responseJson).toEqual(allAppRoles);
});
