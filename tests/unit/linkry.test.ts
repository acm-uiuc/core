import { expect, test, vi } from "vitest";
import {
  DynamoDBClient,
  ScanCommand,
  QueryCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
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

// Mock the Cloudfront KV client to prevent the actual Cloudfront KV call
// aws-sdk-client-mock doesn't support Cloudfront KV Client API
vi.mock("../../src/api/functions/cloudfrontKvStore.js", async () => {
  return {
    setKey: vi.fn(),
    deleteKey: vi.fn(),
    getKey: vi.fn().mockResolvedValue("https://www.acm.illinois.edu"),
    getLinkryKvArn: vi
      .fn()
      .mockResolvedValue(
        "arn:aws:cloudfront::1234567890:key-value-store/bb90421c-e923-4bd7-a42a-7281150389c3s",
      ),
  };
});

const app = await init();

(app as any).nodeCache.flushAll();
ddbMock.reset();
smMock.reset();
vi.useFakeTimers();

// Mock secrets manager
smMock.on(GetSecretValueCommand).resolves({
  SecretString: secretJson,
});

const testJwt = createJwt(undefined, "0", "test@gmail.com");

test("Happy path: Fetch all linkry redirects with proper roles", async () => {
  ddbMock.on(QueryCommand).resolves({
    Items: [],
  });

  ddbMock
    .on(ScanCommand)
    .resolvesOnce({
      Items: [],
    })
    .rejects();

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/linkry/redir",
    headers: {
      Authorization: `Bearer ${testJwt}`,
    },
  });

  expect(response.statusCode).toBe(200);
});

test("Make sure that a DB scan is only called for admins", async () => {
  const testManagerJwt = createJwt(undefined, "999", "test@gmail.com");

  ddbMock.on(QueryCommand).resolves({
    Items: [],
  });

  ddbMock.on(ScanCommand).rejects();

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/linkry/redir",
    headers: {
      Authorization: `Bearer ${testManagerJwt}`,
    },
  });

  expect(response.statusCode).toBe(200);
});

test("Happy path: Create a new linkry redirect", async () => {
  ddbMock.on(QueryCommand).resolves({
    Items: [],
  });

  ddbMock.on(TransactWriteItemsCommand).resolves({});

  const payload = {
    access: [],
    redirect: "https://www.acm.illinois.edu/",
    slug: "acm-test-slug",
  };

  const response = await supertest(app.server)
    .post("/api/v1/linkry/redir")
    .set("Authorization", `Bearer ${testJwt}`)
    .send(payload);

  expect(response.statusCode).toBe(201);
});
