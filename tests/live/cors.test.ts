import { describe, expect, test } from "vitest";
import { getBaseEndpoint } from "./utils.js";

const baseEndpoint = getBaseEndpoint();

describe("CORS tests", async () => {
  test("Events: Known URL is allowed in CORS", async () => {
    const response = await fetch(`${baseEndpoint}/api/v1/events`, {
      headers: {
        Origin: "https://acmuiuc.pages.dev",
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toStrictEqual(
      "https://acmuiuc.pages.dev",
    );
  });
  test("Events: Unknown URL is not allowed in CORS", async () => {
    const response = await fetch(`${baseEndpoint}/api/v1/events`, {
      headers: {
        Origin: "https://google.com",
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers).not.toHaveProperty("access-control-allow-origin");
  });
  test("Membership: Known URL is allowed in CORS", async () => {
    const response = await fetch(`${baseEndpoint}/api/v1/membership/zzzzzz`, {
      headers: {
        Origin: "https://acmuiuc.pages.dev",
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toStrictEqual(
      "https://acmuiuc.pages.dev",
    );
  });
  test("Membership: Unknown URL is not allowed in CORS", async () => {
    const response = await fetch(`${baseEndpoint}/api/v1/membership/zzzzzz`, {
      headers: {
        Origin: "https://google.com",
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers).not.toHaveProperty("access-control-allow-origin");
  });
});
