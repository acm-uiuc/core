import "zod-openapi/extend";
import { vi, afterEach } from "vitest";
import { allAppRoles, AppRoles } from "../../src/common/roles.js";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { mockClient } from "aws-sdk-client-mock";
import { marshall } from "@aws-sdk/util-dynamodb";
import { genericConfig } from "../../src/common/config.js";
import { secretJson } from "./secret.testdata.js";

const ddbMock = mockClient(DynamoDBClient);
const smMock = mockClient(SecretsManagerClient);
vi.mock(
  import("../../src/api/functions/rateLimit.js"),
  async (importOriginal) => {
    const mod = await importOriginal();
    return {
      ...mod,
      isAtLimit: vi.fn(async (_) => {
        return { limited: false, resetTime: 0, used: 1 };
      }),
    };
  },
);

vi.mock(
  import("../../src/api/functions/authorization.js"),
  async (importOriginal) => {
    const mod = await importOriginal();
    return {
      ...mod,
      getUserRoles: vi.fn(async (_, userEmail) => {
        const mockUserRoles = {
          "infra-unit-test-nogrp@acm.illinois.edu": [AppRoles.TICKETS_SCANNER],
          "infra-unit-test-stripeonly@acm.illinois.edu": [
            AppRoles.STRIPE_LINK_CREATOR,
          ],
          kLkvWTYwNnJfBkIK7mBi4niXXHYNR7ygbV8utlvFxjw: allAppRoles,
        };

        return mockUserRoles[userEmail as any] || [];
      }),

      getGroupRoles: vi.fn(async (_, groupId) => {
        const mockGroupRoles = {
          "0": allAppRoles,
          "1": [],
          "scanner-only": [AppRoles.TICKETS_SCANNER],
          LINKS_ADMIN: [AppRoles.LINKS_ADMIN],
          LINKS_MANAGER: [AppRoles.LINKS_MANAGER],
          "999": [AppRoles.STRIPE_LINK_CREATOR],
        };

        return mockGroupRoles[groupId as any] || [];
      }),
    };
  },
);

vi.mock(
  import("../../src/api/functions/membership.js"),
  async (importOriginal) => {
    const mod = await importOriginal();
    return {
      ...mod,
      checkPaidMembershipFromTable: vi.fn(async (netId, _dynamoClient) => {
        switch (netId) {
          case "valid":
            return true;
          default:
            return false;
        }
      }),
      checkPaidMembershipFromEntra: vi.fn(
        async (netId, _entraToken, _paidMemberGroup) => {
          switch (netId) {
            case "valid":
              return true;
            case "eadon2":
              return true;
            default:
              return false;
          }
        },
      ),
    };
  },
);

ddbMock.on(QueryCommand).callsFake((command) => {
  if (command.input.TableName === genericConfig.MembershipTableName) {
    const requestedEmail = command.input.ExpressionAttributeValues[":pk"].S;
    const mockMembershipData = {
      "valid@illinois.edu": {
        email: "valid@illinois.edu",
        inserted_at: "2025-03-08T20:46:36.517561",
        inserted_by: "core-api-provisioned",
      },
    };

    return Promise.resolve({
      Items: mockMembershipData[requestedEmail]
        ? [marshall(mockMembershipData[requestedEmail])]
        : [],
    });
  }
  return Promise.reject(new Error("Table not mocked"));
});

smMock.on(GetSecretValueCommand).callsFake((command) => {
  if (command.SecretId == genericConfig.ConfigSecretName) {
    return Promise.resolve({ SecretString: secretJson });
  }
  return Promise.reject(new Error("Secret ID not mocked"));
});

vi.mock("ioredis", () => import("ioredis-mock"));

let mockCacheStore = new Map();

vi.mock(import("../../src/api/functions/cache.js"), async (importOriginal) => {
  const mod = await importOriginal();

  // Create mock functions
  const getItemFromCacheMock = vi.fn(async (_, key) => {
    const item = mockCacheStore.get(key);
    if (!item) return null;

    const currentTime = Math.floor(Date.now() / 1000);
    if (item.expireAt < currentTime) {
      mockCacheStore.delete(key);
      return null;
    }

    return item;
  });

  const insertItemIntoCacheMock = vi.fn(async (_, key, value, expireAt) => {
    const item = {
      primaryKey: key,
      expireAt: Math.floor(expireAt.getTime() / 1000),
      ...value,
    };
    mockCacheStore.set(key, item);
  });

  const atomicIncrementCacheCounterMock = vi.fn(
    async (_, key, amount, returnOld = false) => {
      let item = mockCacheStore.get(key);
      const oldValue = item?.counterValue || 0;
      const newValue = oldValue + amount;

      // Create or update the item
      if (!item) {
        item = { primaryKey: key, counterValue: newValue };
      } else {
        item.counterValue = newValue;
      }

      mockCacheStore.set(key, item);
      return returnOld ? oldValue : newValue;
    },
  );

  const getCacheCounterMock = vi.fn(async (_, key, defaultValue = 0) => {
    const item = mockCacheStore.get(key);
    return item?.counterValue !== undefined ? item.counterValue : defaultValue;
  });

  const deleteCacheCounterMock = vi.fn(async (_, key) => {
    const item = mockCacheStore.get(key);
    if (!item) return null;

    const counterValue =
      item.counterValue !== undefined ? item.counterValue : 0;
    mockCacheStore.delete(key);
    return counterValue;
  });

  // Clear cache store when mocks are reset
  afterEach(() => {
    mockCacheStore.clear();
  });

  return {
    ...mod,
    getItemFromCache: getItemFromCacheMock,
    insertItemIntoCache: insertItemIntoCacheMock,
    atomicIncrementCacheCounter: atomicIncrementCacheCounterMock,
    getCacheCounter: getCacheCounterMock,
    deleteCacheCounter: deleteCacheCounterMock,
  };
});
