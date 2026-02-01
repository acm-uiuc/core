import { expect, test, describe, afterAll } from "vitest";
import { createJwt, getBaseEndpoint } from "./utils.js";

const baseEndpoint = getBaseEndpoint();

describe(
  "RSVP Configuration Lifecycle (Live)",
  { sequential: true },
  async () => {
    let createdEventUuid: string;
    afterAll(async () => {
      if (createdEventUuid) {
        try {
          const token = await createJwt();
          await fetch(`${baseEndpoint}/api/v1/events/${createdEventUuid}`, {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
        } catch (error) {
          /* empty */
        }
      }
    });

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
      if (!createdEventUuid) {
        throw new Error("Event UUID not found");
      }
      const token = await createJwt();

      const payload = {
        rsvpLimit: 50,
        rsvpCheckInEnabled: true,
        rsvpOpenAt: Math.floor(Date.now() / 1000) + 10,
        rsvpCloseAt: Math.floor(Date.now() / 1000) + 86400,
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
        },
      );
      expect(response.status).toBe(200);

      const getResponse = await fetch(
        `${baseEndpoint}/api/v1/rsvp/event/${createdEventUuid}/config`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      expect(getResponse.status).toBe(200);
      const getResponseJson = await getResponse.json();
      expect(getResponseJson.rsvpLimit).toBe(50);
      expect(getResponseJson.rsvpCheckInEnabled).toBe(true);
    });

    test("Update RSVP Configuration", { timeout: 30000 }, async () => {
      if (!createdEventUuid) {
        throw new Error("Event UUID not found");
      }
      const token = await createJwt();
      const newOpenDate = Math.floor(Date.now() / 1000) - 100;
      const newCloseDate = Math.floor(Date.now() / 1000) + 100;
      const payload = {
        rsvpLimit: 100,
        rsvpCheckInEnabled: false,
        rsvpOpenAt: newOpenDate,
        rsvpCloseAt: newCloseDate,
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
        },
      );
      console.log(response);

      expect(response.status).toBe(200);
      const getResponse = await fetch(
        `${baseEndpoint}/api/v1/rsvp/event/${createdEventUuid}/config`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      expect(getResponse.status).toBe(200);
      const getResponseJson = await getResponse.json();
      expect(getResponseJson.rsvpLimit).toBe(100);
      expect(getResponseJson.rsvpCheckInEnabled).toBe(false);
      expect(getResponseJson.rsvpOpenAt).toBe(newOpenDate);
      expect(getResponseJson.rsvpCloseAt).toBe(newCloseDate);
    });

    test("Fail on Invalid Configuration", { timeout: 30000 }, async () => {
      if (!createdEventUuid) {
        throw new Error("Event UUID not found");
      }
      const token = await createJwt();

      const payload = {
        rsvpLimit: -5,
        rsvpOpenAt: Math.floor(Date.now() / 1000) + 5,
        rsvpCloseAt: Math.floor(Date.now() / 1000) + 10,
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
        },
      );

      expect(response.status).toBe(400);
    });
  },
);
