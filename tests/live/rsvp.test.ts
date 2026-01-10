import { expect, test, describe } from "vitest";
import { createJwt, getBaseEndpoint } from "./utils.js";

const baseEndpoint = getBaseEndpoint();

describe("RSVP Configuration Lifecycle (Live)", { sequential: true }, async () => {
  let createdEventUuid: string;

  test("Setup: Create a live event", { timeout: 30000 }, async () => {
    const token = await createJwt();
    const response = await fetch(`${baseEndpoint}/api/v1/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Live Testing Event",
        description: "An event of all time",
        start: new Date(Date.now() + 100000).toISOString(),
        end: new Date(Date.now() + 200000).toISOString(),
        location: "ACM Room (Siebel 1104)",
        host: "ACM",
        featured: true,
        repeats: "weekly",
      }),
    });

    if (response.headers.get("location")) {
      createdEventUuid = response.headers
        .get("location")!
        .split("/")
        .at(-1) as string;
    }

    expect(response.headers.get("location")).toBeDefined();
    expect(response.headers.get("location")).not.toBeNull();
    expect(response.status).toBe(201);
  });

  test("Set Full RSVP Configuration", { timeout: 30000 }, async () => {
    if (!createdEventUuid) throw new Error("Event UUID not found");
    const token = await createJwt();

    const payload = {
      rsvpLimit: 50,
      rsvpCheckInEnabled: true,
      rsvpOpenAt: Date.now(),
      rsvpCloseAt: Date.now() + 86400000,
      rsvpQuestions: [
        {
          id: "diet",
          prompt: "Dietary Restrictions",
          type: "TEXT",
          required: false,
        },
        {
          id: "tshirt",
          prompt: "T-Shirt Size",
          type: "SELECT",
          options: ["S", "M", "L"],
          required: true,
        }
      ]
    };

    const response = await fetch(
      `${baseEndpoint}/api/v1/rsvp/event/${createdEventUuid}/config`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    expect(response.status).toBe(200);
  });

  test("Update RSVP Configuration", { timeout: 30000 }, async () => {
    if (!createdEventUuid) throw new Error("Event UUID not found");
    const token = await createJwt();

    const payload = {
      rsvpLimit: 100,
      rsvpCheckInEnabled: false,
      rsvpOpenAt: Date.now(),
      rsvpCloseAt: Date.now() + 86400000,
      rsvpQuestions: []
    };

    const response = await fetch(
      `${baseEndpoint}/api/v1/rsvp/event/${createdEventUuid}/config`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    expect(response.status).toBe(200);
  });

  test("Fail on Invalid Configuration", { timeout: 30000 }, async () => {
    if (!createdEventUuid) throw new Error("Event UUID not found");
    const token = await createJwt();

    const payload = {
      rsvpLimit: -5,
      rsvpOpenAt: Date.now(),
      rsvpCloseAt: Date.now() + 86400000,
    };

    const response = await fetch(
      `${baseEndpoint}/api/v1/rsvp/event/${createdEventUuid}/config`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    expect(response.status).toBe(400);
  });

  test("Cleanup: Delete test event", { timeout: 30000 }, async () => {
    if (!createdEventUuid) throw new Error("Event UUID not found");
    const token = await createJwt();

    const response = await fetch(
      `${baseEndpoint}/api/v1/events/${createdEventUuid}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    expect(response.status).toBe(204);
  });
});
