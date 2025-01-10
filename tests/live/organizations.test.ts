import { expect, test } from "vitest";
import { InternalServerError } from "../../src/common/errors/index.js";

const baseEndpoint = `https://infra-core-api.aws.qa.acmuiuc.org`;

test("getting organizations", async () => {
  const response = await fetch(`${baseEndpoint}/api/v1/organizations`);
  expect(response.status).toBe(200);
  const responseJson = (await response.json()) as string[];
  expect(responseJson.length).greaterThan(0);
  expect(responseJson).toContain("ACM");
  expect(responseJson).toContain("Infrastructure Committee");
});
