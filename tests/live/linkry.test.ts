import { describe, expect, test } from "vitest";
import {
  createJwt,
  getBaseEndpoint,
  makeRandomString,
  sleep,
} from "./utils.js";
import { randomUUID } from "node:crypto";

const baseEndpoint = getBaseEndpoint("go");
const coreBaseEndpoint = getBaseEndpoint("core");
const baseEndpointInfra = getBaseEndpoint("infra.go");
const token = await createJwt();
const linkId = `live-${randomUUID()}`;

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

describe("Linkry normal link lifecycle", { sequential: true }, async () => {
  test("Create a short link", async () => {
    const response = await fetch(`${coreBaseEndpoint}/api/v1/linkry/redir`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        slug: linkId,
        access: [],
        redirect: "https://www.google.com/",
      }),
    });
    expect(response.status).toBe(201);
    // Make sure link propogates
    await sleep(1000);
    const redirResponse = await fetch(`${baseEndpoint}/${linkId}`);
    expect(redirResponse.status).toBe(200);
    expect(redirResponse.redirected).toBe(true);
    expect(redirResponse.url).toBe("https://www.google.com/");
  });
  test("Delete a short link", async () => {
    let response;
    response = await fetch(
      `${coreBaseEndpoint}/api/v1/linkry/redir/${linkId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
    expect(response.status).toBe(204);
  });
});

describe("Linkry org link lifecycle", { sequential: true }, async () => {
  test("Create a short link", async () => {
    const response = await fetch(
      `${coreBaseEndpoint}/api/v1/linkry/orgs/C01/redir`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          slug: linkId,
          access: [],
          redirect: "https://www.google.com/",
        }),
      },
    );
    expect(response.status).toBe(201);
    // Make sure link propogates
    await sleep(1000);
    const redirResponse = await fetch(`${baseEndpointInfra}/${linkId}`);
    expect(redirResponse.status).toBe(200);
    expect(redirResponse.redirected).toBe(true);
    expect(redirResponse.url).toBe("https://www.google.com/");
  });
  test("Delete a short link", async () => {
    let response;
    response = await fetch(
      `${coreBaseEndpoint}/api/v1/linkry/orgs/C01/redir/${linkId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
    expect(response.status).toBe(204);
  });
});
