import { afterAll, expect, test, beforeEach, vi } from "vitest";
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  ScanCommand,
  QueryCommand,
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
import { marshall } from "@aws-sdk/util-dynamodb";

const ddbMock = mockClient(DynamoDBClient);
const smMock = mockClient(SecretsManagerClient);
const jwt_secret = secretObject["jwt_key"];
vi.stubEnv("JwtSigningKey", jwt_secret);

// Mock the Discord client to prevent the actual Discord API call
vi.mock("../../src/api/functions/discord.js", async () => {
  return {
    updateDiscord: vi.fn().mockResolvedValue({}),
  };
});

const app = await init();

// 1. Check initial etag for all events is 0
// const initialAllResponse = await app.inject({
//     method: "GET",
//     url: "/api/v1/linkry/redir",
//     headers: {
//         Authorization: `Bearer ${testJwt}`,
//     },
// });

(app as any).nodeCache.flushAll();
ddbMock.reset();
smMock.reset();
vi.useFakeTimers();

// Mock secrets manager
smMock.on(GetSecretValueCommand).resolves({
  SecretString: secretJson,
});

// Mock successful DynamoDB operations
ddbMock.on(PutItemCommand).resolves({});

// Mock ScanCommand to return empty Items array
ddbMock.on(ScanCommand).resolves({
  Items: [],
});

ddbMock.on(QueryCommand).resolves({
  Items: [],
});

const testAdminJwt = createJwt(undefined, "LINKS_ADMIN");
const testAccessDeniedJwt = createJwt(undefined, "1");

const adminLinkryResponse = await app.inject({
  method: "GET",
  url: "/api/v1/linkry/redir",
  headers: {
    Authorization: `Bearer ${testAdminJwt}`,
  },
});

const accessDeniedLinkryResponse = await app.inject({
  method: "GET",
  url: "/api/v1/linkry/redir",
  headers: {
    Authorization: `Bearer ${testAccessDeniedJwt}`,
  },
});

expect(adminLinkryResponse.statusCode).toBe(200);
expect(accessDeniedLinkryResponse.statusCode).toBe(401);
