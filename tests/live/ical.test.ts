import { describe, expect, test } from "vitest";
import { CoreOrganizationList } from "@acm-uiuc/js-shared";
import ical from "node-ical";
import { getBaseEndpoint } from "./utils.js";
const baseEndpoint = getBaseEndpoint();

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithRateLimit = async (url: string) => {
  const response = await fetch(url);

  // Check rate limit headers
  const remaining = parseInt(
    response.headers.get("X-RateLimit-Remaining") || "2",
    10,
  );
  const reset = parseInt(response.headers.get("X-RateLimit-Reset") || "2", 10);
  const currentTime = Math.floor(Date.now() / 1000);

  if (!isNaN(remaining) && !isNaN(reset) && remaining <= 1) {
    const waitTime = (reset - currentTime) * 1000;
    console.warn(`Rate limit reached, waiting ${waitTime / 1000} seconds...`);
    await delay(waitTime);
  }

  return response;
};

describe(
  "Get calendars per organization with rate limit handling",
  { timeout: 450000 },
  async () => {
    for (const org of CoreOrganizationList) {
      test(`Get ${org} calendar`, async () => {
        await delay(Math.random() * 200);
        const response = await fetchWithRateLimit(
          `${baseEndpoint}/api/v1/ical/${org}`,
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Disposition")).toEqual(
          'attachment; filename="calendar.ics"',
        );
        const calendar = ical.sync.parseICS(await response.text());
        expect(calendar["vcalendar"]["type"]).toEqual("VCALENDAR");
      });
    }
  },
);

test(
  "Check that the ical base works and uses a default host of ACM",
  { timeout: 45000 },
  async () => {
    const response = await fetchWithRateLimit(
      `${baseEndpoint.replace("core", "ical")}/ACM`,
    );
    const responseBase = await fetchWithRateLimit(
      `${baseEndpoint.replace("core", "ical")}`,
    );
    expect(response.status).toBe(200);
    expect(responseBase.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toEqual(
      'attachment; filename="calendar.ics"',
    );
    expect(responseBase.headers.get("Content-Disposition")).toEqual(
      'attachment; filename="calendar.ics"',
    );
    const text1 = await response.text();
    const text2 = await responseBase.text();
    expect(text1).toStrictEqual(text2);

    const calendar = ical.sync.parseICS(text1);
    expect(calendar["vcalendar"]["type"]).toEqual("VCALENDAR");
  },
);
