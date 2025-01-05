import { expect, test } from "vitest";
import { InternalServerError } from "../../src/errors/index.js";
import { EventsGetResponse } from "../../src/api/routes/events.js";

const appKey = process.env.APPLICATION_KEY;
if (!appKey) {
  throw new InternalServerError({ message: "No application key found" });
}

const baseEndpoint = `https://${appKey}.aws.qa.acmuiuc.org`;

test("getting events", async () => {
  const response = await fetch(`${baseEndpoint}/api/v1/events`);
  expect(response.status).toBe(200);
  const responseJson = (await response.json()) as EventsGetResponse;
  expect(responseJson.length).greaterThan(0);
});
