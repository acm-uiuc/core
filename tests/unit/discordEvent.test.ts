import { afterAll, expect, test, beforeEach, vi, Mock } from "vitest";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import init from "../../src/api/index.js";
import { createJwt } from "./auth.test.js";
import { secretJson, secretObject } from "./secret.testdata.js";
import supertest from "supertest";
import { describe } from "node:test";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { updateDiscord } from "../../src/api/functions/discord.js";

const ddbMock = mockClient(DynamoDBClient);
const smMock = mockClient(SecretsManagerClient);

const jwt_secret = secretObject["jwt_key"];
vi.stubEnv("JwtSigningKey", jwt_secret);

vi.mock("../../src/api/functions/discord.js", () => {
  return {
    ...vi.importActual("../../src/api/functions/discord.js"),
    updateDiscord: vi.fn(() => {
      console.log("Updated discord event.");
    }),
  };
});

const app = await init();

// TODO: add discord reject test
describe("Test Events <-> Discord integration", () => {
  test("Happy path: valid publish submission.", async () => {
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
        start: "2024-09-25T18:00:00",
        title: "Fall Semiformal",
        paidEventId: "sp24_semiformal",
      });
    expect(response.statusCode).toBe(200);
    expect((updateDiscord as Mock).mock.calls.length).toBe(1);
  });

  test("Happy path: do not publish repeating events.", async () => {
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
        start: "2024-09-25T18:00:00",
        title: "Fall Semiformal",
        repeats: "weekly",
        paidEventId: "sp24_semiformal",
      });
    expect(response.statusCode).toBe(200);
    expect((updateDiscord as Mock).mock.calls.length).toBe(0);
  });

  afterAll(async () => {
    await app.close();
    vi.useRealTimers();
  });
  beforeEach(() => {
    ddbMock.reset();
    smMock.reset();
    vi.resetAllMocks();
    vi.useFakeTimers();
  });
});
