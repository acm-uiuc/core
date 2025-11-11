import { describe, expect, test } from "vitest";
import { getBaseEndpoint, makeRandomString } from "./utils.js";

const baseEndpoint = getBaseEndpoint("go");
const baseEndpointInfra = getBaseEndpoint("infra.go");

describe("Linkry live tests", async () => {
  test("Linkry health check", async () => {
    const response = await fetch(`${baseEndpoint}/healthz`);
    expect(response.status).toBe(200);
    expect(response.redirected).toBe(true);
    expect(response.url).toBe("https://www.google.com/");
  });
  test("Org-scoped linkry health check", async () => {
    const response = await fetch(`${baseEndpointInfra}/healthz`);
    expect(response.status).toBe(200);
    expect(response.redirected).toBe(true);
    expect(response.url).toBe("https://www.google.com/");
  });
  test("Linkry 404 redirect", async () => {
    const response = await fetch(`${baseEndpoint}/${makeRandomString(16)}`);
    expect(response.status).toBe(200);
    expect(response.redirected).toBe(true);
    expect(response.url).toBe("https://www.acm.illinois.edu/404");
  });
});
