import { expect, test } from "vitest";
import { EventsGetResponse } from "../../src/api/routes/events.js";
import { createJwt } from "./utils.js";
import { describe } from "node:test";

const baseEndpoint = `https://core.aws.qa.acmuiuc.org`;
test("getting events", async () => {
  const response = await fetch(`${baseEndpoint}/api/v1/events`);
  expect(response.status).toBe(200);
  const responseJson = (await response.json()) as EventsGetResponse;
  expect(responseJson.length).greaterThan(0);
});

test("getting events for a given host", async () => {
  const response = await fetch(`${baseEndpoint}/api/v1/events?host=ACM`);
  expect(response.status).toBe(200);

  const responseJson = (await response.json()) as EventsGetResponse;
  expect(responseJson.length).toBeGreaterThan(0);

  responseJson.forEach((event) => {
    expect(event.host).toBe("ACM");
  });
});

describe("Event lifecycle tests", async () => {
  let createdEventUuid;
  test("creating an event", { timeout: 30000 }, async () => {
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
    const responseJson = await response.json();
    expect(response.status).toBe(201);
    expect(responseJson).toHaveProperty("id");
    expect(responseJson).toHaveProperty("resource");
    createdEventUuid = responseJson.id;
  });

  test("deleting a previously-created event", { timeout: 30000 }, async () => {
    if (!createdEventUuid) {
      throw new Error("Event UUID not found");
    }
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
    expect(response.status).toBe(204);
  });

  test("check that deleted events cannot be found", async () => {
    if (!createdEventUuid) {
      throw new Error("Event UUID not found");
    }
    const response = await fetch(
      `${baseEndpoint}/api/v1/events/${createdEventUuid}`,
      {
        method: "GET",
      },
    );
    expect(response.status).toBe(404);
  });
});
