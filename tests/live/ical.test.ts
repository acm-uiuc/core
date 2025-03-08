import { expect, test } from "vitest";
import { describe } from "node:test";
import { OrganizationList } from "../../src/common/orgs.js";
import ical from "node-ical";

const baseEndpoint = `https://core.aws.qa.acmuiuc.org`;

test("getting all events", async () => {
  const response = await fetch(`${baseEndpoint}/api/v1/ical`);
  expect(response.status).toBe(200);
});

describe("Getting specific calendars", async () => {
  for (const org of OrganizationList) {
    test(`Get ${org} calendar`, async () => {
      const response = await fetch(`${baseEndpoint}/api/v1/ical/${org}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Disposition")).toEqual(
        'attachment; filename="calendar.ics"',
      );
      const calendar = ical.sync.parseICS(await response.text());
      expect(calendar["vcalendar"]["type"]).toEqual("VCALENDAR");
    });
  }
});
