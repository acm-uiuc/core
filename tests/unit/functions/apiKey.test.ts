import { expect, test, describe, vi } from "vitest";
import { createApiKey, getApiKeyData, getApiKeyParts, verifyApiKey } from "../../../src/api/functions/apiKey.js";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { genericConfig } from "../../../src/common/config.js";
import { allAppRoles } from "../../../src/common/roles.js";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import Redis from "ioredis-mock"



const ddbMock = mockClient(DynamoDBClient);


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
  test("API key is successfully created and validated", async () => {
    const { apiKey, hashedKey, keyId } = await createApiKey();
    expect(apiKey.slice(0, 8)).toEqual("acmuiuc_");
    expect(keyId.length).toEqual(12);
    expect(countOccurrencesOfChar(apiKey, "_")).toEqual(3);
    const verificationResult = await verifyApiKey({ apiKey, hashedKey });
    expect(verificationResult).toBe(true);
  });
  test("API Keys that don't start with correct prefix are rejected", async () => {
    const { apiKey, hashedKey } = await createApiKey();
    const verificationResult = await verifyApiKey({ apiKey: apiKey.replace("acmuiuc_", "acm_"), hashedKey: hashedKey });
    expect(verificationResult).toBe(false);
  });
  test("API Keys that have an incorrect checksum are rejected", async () => {
    const { apiKey, hashedKey } = await createApiKey();
    const submittedChecksum = apiKey.split("_")[3];
    const verificationResult = await verifyApiKey({ apiKey: apiKey.replace(submittedChecksum, "123456"), hashedKey: hashedKey });
    expect(verificationResult).toBe(false);
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
});
