import { afterAll, describe, expect, test } from "vitest";
import init from "../../src/api/server.js";
import { beforeEach } from "node:test";
import supertest from "supertest";

const app = await init();
describe("Vending routes tests", async () => {
  test("Test getting vending items", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/vending/items",
    });
    expect(response.statusCode).toBe(200);
  });
  test("Test adding vending items", async () => {
    const response = await supertest(app.server)
      .post("/api/v1/vending/items")
      .send({
        name: "Test",
        imageUrl: "https://google.com",
        price: 1,
      });
    expect(response.statusCode).toBe(200);
    expect(response.body).toStrictEqual({ status: "Not implemented." });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    (app as any).redisClient.flushall();
  });
});
