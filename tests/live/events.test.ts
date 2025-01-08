import { expect, test } from "vitest";
import { EventsGetResponse } from "../../src/api/routes/events.js";

const baseEndpoint = `https://infra-core-api.aws.qa.acmuiuc.org`;

test("getting events", async () => {
  const response = await fetch(`${baseEndpoint}/api/v1/events`);
  expect(response.status).toBe(200);
  const responseJson = (await response.json()) as EventsGetResponse;
  expect(responseJson.length).greaterThan(0);
});
