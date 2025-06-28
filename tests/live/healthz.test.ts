import { expect, test } from "vitest";
import { getBaseEndpoint } from "./utils.js";

const baseEndpoint = getBaseEndpoint();

test("healthz", async () => {
  const response = await fetch(`${baseEndpoint}/api/v1/healthz`);
  expect(response.status).toBe(200);
  const responseJson = await response.json();
  expect(responseJson).toEqual({ message: "UP" });
});
