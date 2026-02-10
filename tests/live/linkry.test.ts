import { describe, expect, test } from "vitest";
import {
  createJwt,
  getBaseEndpoint,
  makeRandomString,
  sleep,
} from "./utils.js";
import { randomUUID } from "node:crypto";
import { retryDynamoTransactionWithBackoff } from "../../src/api/utils.js";

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
  test("Org-scoped linkry roots health check", async () => {
    const response = await fetch(baseEndpointInfra);
    expect(response.status).toBe(200);
    expect(response.redirected).toBe(true);
    expect(response.url).toBe("https://infra.acm.illinois.edu/");
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

    // Retry with exponential backoff to allow link to propagate
    let redirResponse: Response | null = null;
    const maxRetries = 5;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(1000 * Math.pow(2, attempt - 1)); // 1s, 2s, 4s, 8s
      }

      redirResponse = await fetch(`${baseEndpoint}/${linkId}`);

      if (
        redirResponse.status === 200 &&
        redirResponse.redirected &&
        redirResponse.url === "https://www.google.com/"
      ) {
        break;
      }
    }

    expect(redirResponse!.status).toBe(200);
    expect(redirResponse!.redirected).toBe(true);
    expect(redirResponse!.url).toBe("https://www.google.com/");
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
    let redirResponse: Response | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      await sleep(500 * Math.pow(2, attempt));
      redirResponse = await fetch(`${baseEndpointInfra}/${linkId}`);
      if (
        redirResponse.status === 200 &&
        redirResponse.redirected &&
        redirResponse.url === "https://www.google.com/"
      ) {
        break;
      }
    }
    expect(redirResponse!.status).toBe(200);
    expect(redirResponse!.redirected).toBe(true);
    expect(redirResponse!.url).toBe("https://www.google.com/");
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
