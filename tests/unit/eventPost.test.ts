import { afterAll, expect, test, beforeEach, vi } from "vitest";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import init from "../../src/api/index.js";
import { createJwt } from "./auth.test.js";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { secretJson, secretObject } from "./secret.testdata.js";
import supertest from "supertest";

const ddbMock = mockClient(DynamoDBClient);
const smMock = mockClient(SecretsManagerClient);
const jwt_secret = secretObject["jwt_key"];
vi.stubEnv("JwtSigningKey", jwt_secret);

const app = await init();

test("Sad path: Not authenticated", async () => {
  await app.ready();
  const response = await supertest(app.server).post("/api/v1/events").send({
    description: "Test paid event.",
    end: "2024-09-25T19:00:00",
    featured: true,
    host: "Social Committee",
    location: "Illini Union",
    start: "2024-09-25T18:00:00",
    title: "Fall Semiformal",
    paidEventId: "sp24_semiformal",
  });

  expect(response.statusCode).toBe(403);
});

test("Sad path: Authenticated but not authorized", async () => {
  await app.ready();
  const testJwt = createJwt(undefined, "1");
  const response = await supertest(app.server)
    .post("/api/v1/events")
    .set("Authorization", `Bearer ${testJwt}`)
    .send({
      description: "Test paid event.",
      end: "2024-09-25T19:00:00",
      featured: true,
      host: "Social Committee",
      location: "Illini Union",
      start: "2024-09-25T18:00:00",
      title: "Fall Semiformal",
      paidEventId: "sp24_semiformal",
    });
  expect(response.statusCode).toBe(401);
});
test("Sad path: Prevent empty body request", async () => {
  await app.ready();
  const testJwt = createJwt(undefined, "0");
  const response = await supertest(app.server)
    .post("/api/v1/events")
    .set("Authorization", `Bearer ${testJwt}`)
    .send();
  expect(response.statusCode).toBe(400);
  expect(response.body).toStrictEqual({
    error: true,
    name: "ValidationError",
    id: 104,
    message: `Required at "title"; Required at "description"; Required at "start"; Required at "location"; Required at "host"`,
  });
});
test("Sad path: Prevent specifying repeatEnds on non-repeating events", async () => {
  ddbMock.on(PutItemCommand).resolves({});
  smMock.on(GetSecretValueCommand).resolves({
    SecretString: secretJson,
  });
  const testJwt = createJwt();
  await app.ready();
  const response = await supertest(app.server)
    .post("/api/v1/events")
    .set("authorization", `Bearer ${testJwt}`)
    .send({
      description: "Test paid event.",
      end: "2024-09-25T19:00:00",
      featured: false,
      host: "Social Committee",
      location: "Illini Union",
      start: "2024-09-25T18:00:00",
      title: "Fall Semiformal",
      repeatEnds: "2024-09-25T18:00:00",
      paidEventId: "sp24_semiformal",
    });

  expect(response.statusCode).toBe(400);
  expect(response.body).toStrictEqual({
    error: true,
    name: "ValidationError",
    id: 104,
    message: "repeats is required when repeatEnds is defined",
  });
});

test("Sad path: Prevent specifying unknown repeat frequencies", async () => {
  ddbMock.on(PutItemCommand).resolves({});
  smMock.on(GetSecretValueCommand).resolves({
    SecretString: secretJson,
  });
  const testJwt = createJwt();
  await app.ready();
  const response = await supertest(app.server)
    .post("/api/v1/events")
    .set("authorization", `Bearer ${testJwt}`)
    .send({
      description: "Test paid event.",
      end: "2024-09-25T19:00:00",
      featured: false,
      host: "Social Committee",
      location: "Illini Union",
      start: "2024-09-25T18:00:00",
      title: "Fall Semiformal",
      repeats: "forever_and_ever",
      paidEventId: "sp24_semiformal",
    });

  expect(response.statusCode).toBe(400);
  expect(response.body).toStrictEqual({
    error: true,
    name: "ValidationError",
    id: 104,
    message: `Invalid enum value. Expected 'weekly' | 'biweekly', received 'forever_and_ever' at "repeats"`,
  });
});

test("Happy path: Adding a non-repeating, featured, paid event", async () => {
  ddbMock.on(PutItemCommand).resolves({});
  smMock.on(GetSecretValueCommand).resolves({
    SecretString: secretJson,
  });
  const testJwt = createJwt();
  await app.ready();
  const response = await supertest(app.server)
    .post("/api/v1/events")
    .set("authorization", `Bearer ${testJwt}`)
    .send({
      description: "Test paid event.",
      end: "2024-09-25T19:00:00",
      featured: true,
      host: "Social Committee",
      location: "Illini Union",
      locationLink: "https://maps.app.goo.gl/rUBhjze5mWuTSUJK9",
      start: "2024-09-25T18:00:00",
      title: "Fall Semiformal",
      paidEventId: "sp24_semiformal",
    });

  expect(response.statusCode).toBe(200);
  const responseDataJson = response.body as { id: string; resource: string };
  expect(responseDataJson).toHaveProperty("id");
  const uuid = responseDataJson["id"];
  expect(responseDataJson).toEqual({
    id: uuid,
    resource: `/api/v1/events/${uuid}`,
  });
});

test("Happy path: Adding a weekly repeating, non-featured, paid event", async () => {
  ddbMock.on(PutItemCommand).resolves({});
  smMock.on(GetSecretValueCommand).resolves({
    SecretString: secretJson,
  });
  const testJwt = createJwt();
  await app.ready();
  const response = await supertest(app.server)
    .post("/api/v1/events")
    .set("authorization", `Bearer ${testJwt}`)
    .send({
      description: "Test paid event.",
      end: "2024-09-25T19:00:00",
      featured: false,
      host: "Social Committee",
      location: "Illini Union",
      start: "2024-09-25T18:00:00",
      title: "Fall Semiformal",
      repeats: "weekly",
      paidEventId: "sp24_semiformal",
    });

  expect(response.statusCode).toBe(200);
  const responseDataJson = response.body as { id: string; resource: string };
  expect(responseDataJson).toHaveProperty("id");
  const uuid = responseDataJson["id"];
  expect(responseDataJson).toEqual({
    id: uuid,
    resource: `/api/v1/events/${uuid}`,
  });
});

afterAll(async () => {
  await app.close();
  vi.useRealTimers();
});
beforeEach(() => {
  ddbMock.reset();
  smMock.reset();
  vi.useFakeTimers();
});
