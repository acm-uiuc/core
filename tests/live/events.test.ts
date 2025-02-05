import { expect, test } from "vitest";
import { EventsGetResponse } from "../../src/api/routes/events.js";
import { createJwt } from "./utils.js";

const baseEndpoint = `https://infra-core-api.aws.qa.acmuiuc.org`;
let createdEventUuid;
test("getting events", async () => {
  const response = await fetch(`${baseEndpoint}/api/v1/events`);
  expect(response.status).toBe(200);
  const responseJson = (await response.json()) as EventsGetResponse;
  expect(responseJson.length).greaterThan(0);
});

test("creating an event", async () => {
  const token = await createJwt();
  const response = await fetch(`${baseEndpoint}/api/v1/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: "Testing Event",
      description: "An event of all time",
      start: "2024-12-31T02:00:00",
      end: "2024-12-31T03:30:00",
      location: "ACM Room (Siebel 1104)",
      host: "ACM",
      featured: true,
    }),
  });
  expect(response.status).toBe(200);
  const responseJson = await response.json();
  expect(responseJson).toHaveProperty("id");
  expect(responseJson).toHaveProperty("resource");
  createdEventUuid = responseJson.id;
});

test.runIf(createdEventUuid)(
  "deleting a previously-created event",
  async () => {
    const token = await createJwt();
    const response = await fetch(
      `${baseEndpoint}/api/v1/events/${createdEventUuid}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
    expect(response.status).toBe(201);
  },
);

test.runIf(createdEventUuid)(
  "check that deleted events cannot be found",
  async () => {
    const response = await fetch(
      `${baseEndpoint}/api/v1/events/${createdEventUuid}`,
      {
        method: "GET",
      },
    );
    expect(response.status).toBe(404);
  },
);
