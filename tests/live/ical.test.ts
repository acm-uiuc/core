import { expect, test } from "vitest";
import { describe } from "node:test";
import { OrganizationList } from "../../src/common/orgs.js";
import ical from "node-ical";
const baseEndpoint = `https://core.aws.qa.acmuiuc.org`;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithRateLimit = async (url) => {
  const response = await fetch(url);
  expect(response.status).toBe(200);

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

test("Get calendars with rate limit handling", { timeout: 30000 }, async () => {
  for (const org of OrganizationList) {
    const response = await fetchWithRateLimit(
      `${baseEndpoint}/api/v1/ical/${org}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toEqual(
      'attachment; filename="calendar.ics"',
    );
    const calendar = ical.sync.parseICS(await response.text());
    expect(calendar["vcalendar"]["type"]).toEqual("VCALENDAR");
  }
});
