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
import {
  UnauthenticatedError,
  ValidationError,
} from "../../src/common/errors/index.js";
import {
  GetParameterCommand,
  GetParametersCommand,
  SSMClient,
} from "@aws-sdk/client-ssm";

const ddbMock = mockClient(DynamoDBClient);
const smMock = mockClient(SecretsManagerClient);
const ssmMock = mockClient(SSMClient);

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

vi.mock(import("../../src/api/functions/uin.js"), async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    verifyUiucAccessToken: vi.fn(
      async ({
        accessToken,
        logger,
      }: {
        accessToken: string | string[] | undefined;
        logger: unknown;
      }) => {
        if (!accessToken) {
          throw new UnauthenticatedError({
            message: "Access token not found.",
          });
        }
        if (Array.isArray(accessToken)) {
          throw new ValidationError({
            message: "Multiple tokens cannot be specified!",
          });
        }
        const validTokens = {
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEsImlhdCI6MTY3Mjc2NjAyOCwiZXhwIjoxNjc0NDk0MDI4fQ.kCak9sLJr74frSRVQp0_27BY4iBCgQSmoT3vQVWKzJg":
            {
              userPrincipalName: "fjkldk99@illinois.edu",
              givenName: "Infra",
              surname: "Testing",
              mail: "fjkldk99@illinois.edu",
              netId: "fjkldk99",
            },
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEsImlhdCI6MTY3Mjc2NjAyOCwiZXhwIjoxNjcyODAyMDI4fQ.P1_rB3hJ5afwiG4TWXLq6jOAcVJkvQZ2Z-ZZOnQ1dZw":
            {
              userPrincipalName: "valid@illinois.edu",
              givenName: "Infra",
              surname: "Testing",
              mail: "valid@illinois.edu",
              netId: "valid",
            },
        };
        if (accessToken in validTokens) {
          return validTokens[accessToken as keyof typeof validTokens];
        } else {
          throw new UnauthenticatedError({
            message: "Invalid or expired access token.",
          });
        }
      },
    ),
  };
});

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

        return mockUserRoles[userEmail as keyof typeof mockUserRoles] || [];
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

        return mockGroupRoles[groupId as keyof typeof mockGroupRoles] || [];
      }),
      clearAuthCache: vi.fn(),
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
      checkPaidMembership: vi.fn(async (obj) => {
        switch (obj.netId) {
          case "jd3":
          case "valid":
          case "oldlead":
          case "newlead":
            return true;
          default:
            return false;
        }
      }),
    };
  },
);

ddbMock.on(QueryCommand).callsFake((command) => {
  if (command.TableName === genericConfig.SigInfoTableName) {
    return Promise.resolve({
      Items: [],
    });
  }
  if (command.TableName === genericConfig.UserInfoTable) {
    const requestedEmail = command.input.ExpressionAttributeValues[":pk"].S;
    const mockMembershipData = {
      "valid@illinois.edu": {
        id: "valid@illinois.edu",
        netId: "valid",
        isPaidMember: true,
        updatedAt: "2025-03-08T20:46:36.517561",
      },
    };

    return Promise.resolve({
      Items: mockMembershipData[
        requestedEmail as keyof typeof mockMembershipData
      ]
        ? [
            marshall(
              mockMembershipData[
                requestedEmail as keyof typeof mockMembershipData
              ],
            ),
          ]
        : [],
    });
  }
  return Promise.reject(new Error("Table not mocked"));
});

smMock.on(GetSecretValueCommand).callsFake((command) => {
  if (command.SecretId == genericConfig.ConfigSecretName) {
    return Promise.resolve({ SecretString: secretJson });
  }
  return Promise.reject(new Error(`Secret ID ${command.SecretID} not mocked`));
});

const ssmParameters: Record<string, string> = {
  "/infra-core-api/jwt_key": "6059bfd2-9179-403f-bf31-affdaa4720c3",
  "/infra-core-api/github_app_id": "9179",
  "/infra-core-api/github_installation_id": "123",
  "/infra-core-api/github_private_key": "123",
  "/infra-core-api/turnstile_secret_key": "1x0000000000000000000000000000000AA",
  "/infra-core-api/listmonk_api_token": "abcdef",
  "/infra-core-api/store_stripe_endpoint_secret": "whsec_abcd123",
};

ssmMock.on(GetParameterCommand).callsFake((command) => {
  const value = ssmParameters[command.Name];
  if (value) {
    return Promise.resolve({ Parameter: { Value: value } });
  }
  return Promise.reject(new Error(`Parameter ${command.Name} not mocked`));
});

ssmMock.on(GetParametersCommand).callsFake((command) => {
  const names: string[] = command.Names || [];
  const parameters = names
    .filter((name) => name in ssmParameters)
    .map((name) => ({ Name: name, Value: ssmParameters[name] }));
  const invalidParameters = names.filter((name) => !(name in ssmParameters));

  if (invalidParameters.length > 0) {
    return Promise.resolve({
      Parameters: parameters,
      InvalidParameters: invalidParameters,
    });
  }
  return Promise.resolve({ Parameters: parameters });
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
