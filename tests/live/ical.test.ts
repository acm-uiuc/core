import { describe, expect, test } from "vitest";
import { AllOrganizationNameList } from "@acm-uiuc/js-shared";
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

test("Check that the ACM host works", { timeout: 45000 }, async () => {
  const response = await fetchWithRateLimit(
    `${baseEndpoint.replace("core", "ical")}/ACM`,
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Disposition")).toEqual(
    'attachment; filename="calendar.ics"',
  );
  const text1 = await response.text();
  const calendar = ical.sync.parseICS(text1);
  expect(calendar["vcalendar"]["type"]).toEqual("VCALENDAR");
});

test("Check that the base route works", { timeout: 45000 }, async () => {
  const response = await fetchWithRateLimit(
    `${baseEndpoint.replace("core", "ical")}`,
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Disposition")).toEqual(
    'attachment; filename="calendar.ics"',
  );
  const text1 = await response.text();
  const calendar = ical.sync.parseICS(text1);
  expect(calendar["vcalendar"]["type"]).toEqual("VCALENDAR");
});
