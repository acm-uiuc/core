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
import { dynamoTableData } from "./mockLinkryData.testdata.js";

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

const adminJwt = createJwt(undefined, ["LINKS_ADMIN"], "test@gmail.com");

test("Happy path: Fetch all linkry redirects with admin roles", async () => {
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
      Authorization: `Bearer ${adminJwt}`,
    },
  });

  expect(response.statusCode).toBe(200);
});

test("Make sure that a DB scan is only called for admins", async () => {
  const testManagerJwt = createJwt(
    undefined,
    ["LINKS_MANAGER"],
    "test@gmail.com",
  );

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
    .set("Authorization", `Bearer ${adminJwt}`)
    .send(payload);

  expect(response.statusCode).toBe(201);
});

test("Happy path: Get Delegated Link by Slug Correct Access", async () => {
  const userJwt = createJwt(
    undefined,
    ["LINKS_MANAGER", "940e4f9e-6891-4e28-9e29-148798495cdb"],
    "cloud@illinois.edu",
  );
  ddbMock.on(QueryCommand).resolves({
    Items: dynamoTableData,
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/linkry/redir/WlQDmu",
    headers: {
      Authorization: `Bearer ${userJwt}`,
    },
  });
  expect(response.statusCode).toBe(200);
  let body = JSON.parse(response.body);
  expect(body).toEqual({
    slug: "WlQDmu",
    access: [
      "f8dfc4cf-456b-4da3-9053-f7fdeda5d5d6",
      "940e4f9e-6891-4e28-9e29-148798495cdb",
    ],
    createdAt: "2025-04-18T18:36:50.706Z",
    redirect: "https://www.gmaill.com",
    updatedAt: "2025-04-18T18:37:40.681Z",
    owner: "bob@illinois.edu",
  });
});

test("Happy path: Get Delegated Link by Slug Admin Access", async () => {
  const userJwt = createJwt(undefined, ["LINKS_ADMIN"], "test@illinois.edu");
  ddbMock.on(QueryCommand).resolves({
    Items: dynamoTableData,
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/linkry/redir/WlQDmu",
    headers: {
      Authorization: `Bearer ${userJwt}`,
    },
  });
  expect(response.statusCode).toBe(200);
  let body = JSON.parse(response.body);
  expect(body).toEqual({
    slug: "WlQDmu",
    access: [
      "f8dfc4cf-456b-4da3-9053-f7fdeda5d5d6",
      "940e4f9e-6891-4e28-9e29-148798495cdb",
    ],
    createdAt: "2025-04-18T18:36:50.706Z",
    redirect: "https://www.gmaill.com",
    updatedAt: "2025-04-18T18:37:40.681Z",
    owner: "bob@illinois.edu",
  });
});

test("Unhappy path: Get Delegated Link by Slug Incorrect Access", async () => {
  const userJwt = createJwt(
    undefined,
    ["LINKS_MANAGER", "NotValidGroupId222"],
    "cloud@illinois.edu",
  );

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/linkry/redir/WlQDmu",
    headers: {
      Authorization: `Bearer ${userJwt}`,
    },
  });
  expect(response.statusCode).toBe(404);
});
