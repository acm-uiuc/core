import { afterAll, expect, test } from "vitest";
import init from "../../src/api/index.js";
import { EventGetResponse } from "../../src/api/routes/events.js";

const app = await init();
test("Test getting events", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/healthz",
  });
  expect(response.statusCode).toBe(200);
  const responseDataJson = (await response.json()) as EventGetResponse;
  expect(responseDataJson).toEqual({ message: "UP" });
});
afterAll(async () => {
  await app.close();
});
