import { createHash, randomBytes } from "crypto";
import * as argon2 from "argon2";
import { UnauthenticatedError } from "common/errors/index.js";
import NodeCache from "node-cache";
import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { genericConfig } from "common/config.js";
import { AUTH_DECISION_CACHE_SECONDS as API_KEY_DATA_CACHE_SECONDS } from "./authorization.js";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { ApiKeyMaskedEntry, DecomposedApiKey } from "common/types/apiKey.js";
import { AvailableAuthorizationPolicy } from "common/policies/definition.js";

export type ApiKeyDynamoEntry = ApiKeyMaskedEntry & {
  keyHash: string;
  restrictions?: AvailableAuthorizationPolicy[];
};

function min(a: number, b: number) {
  return a < b ? a : b;
}

export const API_KEY_CACHE_SECONDS = 120;

export const createChecksum = (key: string) => {
  return createHash("sha256").update(key).digest("hex").slice(0, 6);
};

export const createApiKey = async () => {
  const keyId = randomBytes(6).toString("hex");
  const prefix = `acmuiuc_${keyId}`;
  const rawKey = randomBytes(32).toString("hex");
  const checksum = createChecksum(rawKey);
  const apiKey = `${prefix}_${rawKey}_${checksum}`;
  const hashedKey = await argon2.hash(rawKey);
  return { apiKey, hashedKey, keyId };
};

export const getApiKeyParts = (apiKey: string): DecomposedApiKey => {
  const [prefix, id, rawKey, checksum] = apiKey.split("_");
  if (!prefix || !id || !rawKey || !checksum) {
    throw new UnauthenticatedError({
      message: "Invalid API key.",
    });
  }
  if (
    prefix !== "acmuiuc" ||
    id.length !== 12 ||
    rawKey.length !== 64 ||
    checksum.length !== 6
  ) {
    throw new UnauthenticatedError({
      message: "Invalid API key.",
    });
  }
  return {
    prefix,
    id,
    rawKey,
    checksum,
  };
};

export const verifyApiKey = async ({
  apiKey,
  hashedKey,
}: {
  apiKey: string;
  hashedKey: string;
}) => {
  try {
    const { rawKey, checksum: submittedChecksum } = getApiKeyParts(apiKey);
    const isChecksumValid = createChecksum(rawKey) === submittedChecksum;
    if (!isChecksumValid) {
      return false;
    }
    return await argon2.verify(hashedKey, rawKey);
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return false;
    }
    throw e;
  }
};

export const getApiKeyData = async ({
  nodeCache,
  dynamoClient,
  id,
}: {
  nodeCache: NodeCache;
  dynamoClient: DynamoDBClient;
  id: string;
}): Promise<ApiKeyDynamoEntry | undefined> => {
  const cacheKey = `auth_apikey_${id}`;
  const cachedValue = nodeCache.get(`auth_apikey_${id}`);
  if (cachedValue !== undefined) {
    return cachedValue as ApiKeyDynamoEntry;
  }
  const getCommand = new GetItemCommand({
    TableName: genericConfig.ApiKeyTable,
    Key: { keyId: { S: id } },
  });
  const result = await dynamoClient.send(getCommand);
  if (!result || !result.Item) {
    nodeCache.set(cacheKey, null, API_KEY_DATA_CACHE_SECONDS);
    return undefined;
  }
  const unmarshalled = unmarshall(result.Item) as ApiKeyDynamoEntry;
  if (
    unmarshalled.expiresAt &&
    unmarshalled.expiresAt <= Math.floor(Date.now() / 1000)
  ) {
    dynamoClient.send(
      new DeleteItemCommand({
        TableName: genericConfig.ApiKeyTable,
        Key: { keyId: { S: id } },
      }),
    ); // don't need to wait for the response
    return undefined;
  }
  if (!("keyHash" in unmarshalled)) {
    return undefined; // bad data, don't cache it
  }
  let cacheTime = API_KEY_DATA_CACHE_SECONDS;
  if (unmarshalled.expiresAt) {
    const currentEpoch = Date.now();
    cacheTime = min(cacheTime, unmarshalled.expiresAt - currentEpoch);
  }
  nodeCache.set(cacheKey, unmarshalled as ApiKeyDynamoEntry, cacheTime);
  return unmarshalled;
};
