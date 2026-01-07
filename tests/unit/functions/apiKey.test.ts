import { expect, test, describe, vi, beforeEach } from "vitest";
import { createApiKey, getApiKeyData, getApiKeyParts, verifyApiKey } from "../../../src/api/functions/apiKey.js";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { genericConfig } from "../../../src/common/config.js";
import { allAppRoles } from "../../../src/common/roles.js";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import Redis from "ioredis-mock"
import { UnauthenticatedError } from "../../../src/common/errors/index.js";



const ddbMock = mockClient(DynamoDBClient);
const redisClient = new Redis.default();


const countOccurrencesOfChar = (s: string, char: string): number => {
  let count = 0;
  for (const item of s) {
    if (item === char) {
      count++;
    }
  }
  return count;
}

describe("API key tests", () => {
  beforeEach(async () => {
    await redisClient.flushall()
  })
  test("API key is successfully created and validated", async () => {
    const { apiKey, hashedKey, keyId } = await createApiKey();
    expect(apiKey.slice(0, 8)).toEqual("acmuiuc_");
    expect(keyId.length).toEqual(12);
    expect(countOccurrencesOfChar(apiKey, "_")).toEqual(3);
    const apiKeyParts = getApiKeyParts(apiKey)
    const verificationResult = await verifyApiKey({ apiKey: apiKeyParts, hashedKey, redisClient });
    expect(verificationResult).toBe(true);
  });
  test("API Keys that don't start with correct prefix are rejected", async () => {
    const { apiKey } = await createApiKey();
    await expect(
      () => getApiKeyParts(apiKey.replace("acmuiuc_", "acm_"))
    ).toThrow(UnauthenticatedError);
  });
  test("API Keys that have an incorrect checksum are rejected", async () => {
    const { apiKey } = await createApiKey();
    const submittedChecksum = apiKey.split("_")[3];
    await expect(
      () => getApiKeyParts(apiKey.replace(submittedChecksum, "123456"))
    ).toThrow(UnauthenticatedError);
  });
  test("Retrieving API keys from DynamoDB works correctly and is cached", async () => {
    const { apiKey, hashedKey } = await createApiKey();
    const { id } = getApiKeyParts(apiKey);
    const keyData = {
      keyId: { S: id },
      keyHash: { S: hashedKey },
      roles: { SS: allAppRoles }
    }
    ddbMock.on(GetItemCommand, {
      TableName: genericConfig.ApiKeyTable,
      Key: { "keyId": { S: id } }
    }).resolves({
      Item: keyData
    })
    const dynamoClient = new DynamoDBClient()
    const redisClient = new Redis.default();
    const result = await getApiKeyData({ redisClient, dynamoClient, id });
    const redisValue = await redisClient.get(`auth_apikey_${id}`)
    expect(result).toEqual(unmarshall(keyData));
    expect(redisValue).toEqual(JSON.stringify(unmarshall(keyData)));
  })
  test("Valid API key verification result is cached", async () => {
    const { apiKey, hashedKey } = await createApiKey();
    const apiKeyParts = getApiKeyParts(apiKey);

    const result = await verifyApiKey({ apiKey: apiKeyParts, hashedKey, redisClient });
    expect(result).toBe(true);

    const keys = await redisClient.keys("*");
    expect(keys.length).toBe(1);
  });
  test("Invalid API key verification result is not cached", async () => {
    const { apiKey } = await createApiKey();
    const { hashedKey: differentHashedKey } = await createApiKey();
    const apiKeyParts = getApiKeyParts(apiKey);

    const result = await verifyApiKey({ apiKey: apiKeyParts, hashedKey: differentHashedKey, redisClient });
    expect(result).toBe(false);

    const keys = await redisClient.keys("*");
    expect(keys.length).toBe(0);
  });
});
