import { afterAll, expect, test, beforeEach, vi, describe } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import init from "../../src/api/index.js";
import { createJwt } from "./auth.test.js";
import { secretJson, secretObject } from "./secret.testdata.js";
import supertest from "supertest";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { AppRoles } from "../../src/common/roles.js";
import { createApiKey } from "../../src/api/functions/apiKey.js";

// Mock the createApiKey function
vi.mock("../../src/api/functions/apiKey.js", () => {
  return {
    createApiKey: vi.fn().mockImplementation(async () => {
      return {
        apiKey: "acmuiuc_test123_abcdefg12345",
        hashedKey: "hashed_key_value",
        keyId: "test123",
      };
    }),
  };
});

// Mock DynamoDB client
const dynamoMock = mockClient(DynamoDBClient);
const smMock = mockClient(SecretsManagerClient);
const jwt_secret = secretObject["jwt_key"];

vi.stubEnv("JwtSigningKey", jwt_secret);

const app = await init();

describe("API Key Route Tests", () => {
  beforeEach(() => {
    dynamoMock.reset();
    smMock.reset();
    vi.clearAllMocks();

    smMock.on(GetSecretValueCommand).resolves({
      SecretString: secretJson,
    });

    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    dynamoMock.on(ScanCommand).resolves({
      Items: [
        {
          keyId: { S: "test123" },
          roles: { L: [{ S: AppRoles.EVENTS_MANAGER }] },
          description: { S: "Test API Key" },
          owner: { S: "testuser" },
          createdAt: { N: "1618012800" },
          keyHash: { S: "hashed_key_value" },
        },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe("Create API Key", () => {
    test("Should create an API key successfully", async () => {
      const testJwt = createJwt();
      await app.ready();

      // Make the request
      const response = await supertest(app.server)
        .post("/api/v1/apiKey/org")
        .set("authorization", `Bearer ${testJwt}`)
        .send({
          roles: [AppRoles.EVENTS_MANAGER],
          description: "Test API Key",
        });

      // Assertions
      expect(response.statusCode).toBe(201);
      expect(response.body).toHaveProperty("apiKey");
      expect(response.body.apiKey).toBe("acmuiuc_test123_abcdefg12345");
      expect(createApiKey).toHaveBeenCalledTimes(1);
      expect(dynamoMock.calls()).toHaveLength(1);
    });

    test("Should create an API key with expiration", async () => {
      const testJwt = createJwt();
      await app.ready();

      const expiryTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      // Make the request
      const response = await supertest(app.server)
        .post("/api/v1/apiKey/org")
        .set("authorization", `Bearer ${testJwt}`)
        .send({
          roles: [AppRoles.EVENTS_MANAGER],
          description: "Test API Key with Expiry",
          expiresAt: expiryTime,
        });

      // Assertions
      expect(response.statusCode).toBe(201);
      expect(response.body).toHaveProperty("apiKey");
      expect(response.body).toHaveProperty("expiresAt");
      expect(response.body.expiresAt).toBe(expiryTime);
      expect(createApiKey).toHaveBeenCalledTimes(1);
      expect(dynamoMock.calls()).toHaveLength(1);
    });

    test("Should not create an API key for invalid API key roles", async () => {
      const testJwt = createJwt();
      await app.ready();

      const expiryTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      // Make the request
      const response = await supertest(app.server)
        .post("/api/v1/apiKey/org")
        .set("authorization", `Bearer ${testJwt}`)
        .send({
          roles: [AppRoles.MANAGE_ORG_API_KEYS],
          description: "Test bad API key",
          expiresAt: expiryTime,
        });

      // Assertions
      expect(response.statusCode).toBe(400);
      console.log(response.body);
      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toEqual(true);
      expect(response.body.name).toEqual("ValidationError");
      expect(response.body.id).toEqual(104);

      expect(createApiKey).toHaveBeenCalledTimes(0);
      expect(dynamoMock.calls()).toHaveLength(0);
    });

    test("Should handle DynamoDB insertion error", async () => {
      // Mock the DynamoDB client to throw an error
      dynamoMock
        .on(TransactWriteItemsCommand)
        .rejects(new Error("DynamoDB error"));

      const testJwt = createJwt();
      await app.ready();

      // Make the request
      const response = await supertest(app.server)
        .post("/api/v1/apiKey/org")
        .set("authorization", `Bearer ${testJwt}`)
        .send({
          roles: [AppRoles.EVENTS_MANAGER],
          description: "Test API Key",
        });

      // Assertions
      expect(response.statusCode).toBe(500);
      expect(response.body).toHaveProperty("message");
      expect(response.body.message).toBe("Could not create API key.");
      expect(createApiKey).toHaveBeenCalledTimes(1);
      expect(dynamoMock.calls()).toHaveLength(1);
    });

    test("Should require authorization", async () => {
      await app.ready();

      // Make the request without a JWT
      const response = await supertest(app.server)
        .post("/api/v1/apiKey/org")
        .send({
          roles: [AppRoles.EVENTS_MANAGER],
          description: "Test API Key",
        });

      // Assertions
      expect(response.statusCode).toBe(403);
    });
  });

  describe("Delete API Key", () => {
    test("Should delete an API key successfully", async () => {
      const testJwt = createJwt();
      await app.ready();

      // Make the request
      const response = await supertest(app.server)
        .delete("/api/v1/apiKey/org/test123")
        .set("authorization", `Bearer ${testJwt}`);

      // Assertions
      expect(response.statusCode).toBe(204);
      expect(dynamoMock.calls()).toHaveLength(1);
    });

    test("Should handle key not found error", async () => {
      // Mock the DynamoDB client to throw ConditionalCheckFailedException
      dynamoMock.on(TransactWriteItemsCommand).rejects(
        new ConditionalCheckFailedException({
          $metadata: {},
          message: "The conditional request failed",
        }),
      );

      const testJwt = createJwt();
      await app.ready();

      // Make the request
      const response = await supertest(app.server)
        .delete("/api/v1/apiKey/org/nonexistent")
        .set("authorization", `Bearer ${testJwt}`);

      // Assertions
      expect(response.statusCode).toBe(400);
      expect(response.body).toHaveProperty("message");
      expect(response.body.message).toBe("Key does not exist.");
      expect(dynamoMock.calls()).toHaveLength(1);
    });

    test("Should handle DynamoDB deletion error", async () => {
      // Mock the DynamoDB client to throw a generic error
      dynamoMock
        .on(TransactWriteItemsCommand)
        .rejects(new Error("DynamoDB error"));

      const testJwt = createJwt();
      await app.ready();

      // Make the request
      const response = await supertest(app.server)
        .delete("/api/v1/apiKey/org/test123")
        .set("authorization", `Bearer ${testJwt}`);

      // Assertions
      expect(response.statusCode).toBe(500);
      expect(response.body).toHaveProperty("message");
      expect(response.body.message).toBe("Could not delete API key.");
      expect(dynamoMock.calls()).toHaveLength(1);
    });

    test("Should require authentication", async () => {
      await app.ready();

      // Make the request without a JWT
      const response = await supertest(app.server).delete(
        "/api/v1/apiKey/org/test123",
      );

      // Assertions
      expect(response.statusCode).toBe(403);
    });
  });

  describe("GET /org - Get All API Keys", () => {
    test("Should get all API keys successfully", async () => {
      const testJwt = createJwt();
      await app.ready();

      // Make the request
      const response = await supertest(app.server)
        .get("/api/v1/apiKey/org")
        .set("authorization", `Bearer ${testJwt}`);

      // Assertions
      expect(response.statusCode).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(1);
      expect(response.body[0]).toHaveProperty("keyId", "test123");
      expect(response.body[0]).toHaveProperty("description", "Test API Key");
      expect(response.body[0]).not.toHaveProperty("keyHash"); // keyHash should be filtered out
      expect(dynamoMock.calls()).toHaveLength(1);
    });

    test("Should handle empty result", async () => {
      // Mock the DynamoDB client to return empty results
      dynamoMock.on(ScanCommand).resolves({
        Items: [],
      });

      const testJwt = createJwt();
      await app.ready();

      // Make the request
      const response = await supertest(app.server)
        .get("/api/v1/apiKey/org")
        .set("authorization", `Bearer ${testJwt}`);

      // Assertions
      expect(response.statusCode).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(0);
      expect(dynamoMock.calls()).toHaveLength(1);
    });

    test("Should handle missing Items in response", async () => {
      // Mock the DynamoDB client to return a response without Items
      dynamoMock.on(ScanCommand).resolves({});

      const testJwt = createJwt();
      await app.ready();

      // Make the request
      const response = await supertest(app.server)
        .get("/api/v1/apiKey/org")
        .set("authorization", `Bearer ${testJwt}`);

      // Assertions
      expect(response.statusCode).toBe(500);
      expect(response.body).toHaveProperty("message");
      expect(response.body.message).toBe("Could not fetch API keys.");
      expect(dynamoMock.calls()).toHaveLength(1);
    });

    test("Should handle DynamoDB fetch error", async () => {
      // Mock the DynamoDB client to throw an error
      dynamoMock.on(ScanCommand).rejects(new Error("DynamoDB error"));

      const testJwt = createJwt();
      await app.ready();

      // Make the request
      const response = await supertest(app.server)
        .get("/api/v1/apiKey/org")
        .set("authorization", `Bearer ${testJwt}`);

      // Assertions
      expect(response.statusCode).toBe(500);
      expect(response.body).toHaveProperty("message");
      expect(response.body.message).toBe("Could not fetch API keys.");
      expect(dynamoMock.calls()).toHaveLength(1);
    });

    test("Should require authentication", async () => {
      await app.ready();

      // Make the request without a JWT
      const response = await supertest(app.server).get("/api/v1/apiKey/org");

      // Assertions
      expect(response.statusCode).toBe(403);
    });
  });
});
