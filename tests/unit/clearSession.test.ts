import { expect, test, vi, describe, beforeEach } from "vitest";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import init from "../../src/api/server.js";
import { createJwt } from "./utils.js";
import { secretObject } from "./secret.testdata.js";
import supertest from "supertest";
import { afterEach } from "node:test";
import jwt from "jsonwebtoken";

const app = await init();

const ddbMock = mockClient(DynamoDBClient);
const jwt_secret = secretObject["jwt_key"];
vi.stubEnv("JwtSigningKey", jwt_secret);
vi.mock("ioredis", () => import("ioredis-mock"));

describe("RSVP API tests", () => {
  beforeEach(() => {
    ddbMock.reset();
    vi.clearAllMocks();
  });
  afterEach(() => {
    app.redisClient.flushall();
  });
  test("Happy path: the user's JWT is invalidated", async () => {
    const testJwt = createJwt();
    const jwtUti = (
      jwt.decode(testJwt, { complete: true })?.payload as { uti: string }
    ).uti;
    await app.ready();
    const initialRedisResponse = await app.redisClient.get(
      `tokenRevocationList:${jwtUti}`,
    );
    expect(initialRedisResponse).toEqual(null);
    const response = await supertest(app.server)
      .post("/api/v1/clearSession")
      .set("authorization", `Bearer ${testJwt}`)
      .send();
    const redisResponse = await app.redisClient.get(
      `tokenRevocationList:${jwtUti}`,
    );
    expect(redisResponse).toEqual(`{"isInvalid":true}`);
    expect(response.statusCode).toBe(201);
  });
});
