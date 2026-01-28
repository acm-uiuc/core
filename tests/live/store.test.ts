import { describe, expect, test } from "vitest";
import { getBaseEndpoint } from "./utils.js";

const baseEndpoint = getBaseEndpoint();

describe("Get store products", async () => {
  test("Get all store products", async () => {
    const response = await fetch(`${baseEndpoint}/api/v1/store/products`);
    expect(response.status).toBe(200);
    const getResponseJson = await response.json();
    expect(getResponseJson).toHaveProperty("products");
    expect(getResponseJson["products"].length).toBeGreaterThan(1);
  });
});
