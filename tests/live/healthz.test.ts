import { expect, test } from "vitest";
import { InternalServerError } from "../../src/common/errors/index.js";

const baseEndpoint = `https://core.aws.qa.acmuiuc.org`;

test("healthz", async () => {
  const response = await fetch(`${baseEndpoint}/api/v1/healthz`);
  expect(response.status).toBe(200);
  const responseJson = await response.json();
  expect(responseJson).toEqual({ message: "UP" });
});
