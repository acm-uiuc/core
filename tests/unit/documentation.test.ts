import { afterAll, expect, test } from "vitest";
import init from "../../src/api/index.js";

const app = await init();
test("Test getting OpenAPI JSON", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/documentation/json",
  });
  expect(response.statusCode).toBe(200);
  const responseDataJson = await response.json();
  expect(responseDataJson).toHaveProperty("openapi");
  expect(responseDataJson["openapi"]).toEqual("3.1.0");
});
afterAll(async () => {
  await app.close();
});

test("Test getting OpenAPI UI", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/documentation",
  });
  expect(response.statusCode).toBe(200);
  const contentType = response.headers["content-type"];
  expect(contentType).toContain("text/html");
});
afterAll(async () => {
  await app.close();
});
