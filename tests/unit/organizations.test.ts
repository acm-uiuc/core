import { afterAll, expect, test, beforeEach } from "vitest";
import init from "../../src/api/index.js";

const app = await init();
test("Test getting the list of organizations succeeds", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/organizations",
  });
  expect(response.statusCode).toBe(200);
  await response.json();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  (app as any).nodeCache.flushAll();
});
