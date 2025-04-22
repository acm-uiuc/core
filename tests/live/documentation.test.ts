import { expect, test } from "vitest";

const baseEndpoint = `https://core.aws.qa.acmuiuc.org`;

test("Get OpenAPI JSON", async () => {
  const response = await fetch(`${baseEndpoint}/api/documentation/json`);
  expect(response.status).toBe(200);

  const responseDataJson = await response.json();
  expect(responseDataJson).toHaveProperty("openapi");
  expect(responseDataJson["openapi"]).toEqual("3.0.3");
});

test("Get OpenAPI UI", async () => {
  const response = await fetch(`${baseEndpoint}/api/documentation`);
  expect(response.status).toBe(200);
  const contentType = response.headers.get("content-type");
  expect(contentType).toContain("text/html");
});
