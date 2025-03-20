import { vi } from "vitest";
import { allAppRoles, AppRoles } from "../../src/common/roles.js";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { marshall } from "@aws-sdk/util-dynamodb";
import { genericConfig } from "../../src/common/config.js";

const ddbMock = mockClient(DynamoDBClient);

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
      getUserRoles: vi.fn(async (_, __, userEmail) => {
        const mockUserRoles = {
          "infra-unit-test-nogrp@acm.illinois.edu": [AppRoles.TICKETS_SCANNER],
          "infra-unit-test-stripeonly@acm.illinois.edu": [
            AppRoles.STRIPE_LINK_CREATOR,
          ],
          kLkvWTYwNnJfBkIK7mBi4niXXHYNR7ygbV8utlvFxjw: allAppRoles,
        };

        return mockUserRoles[userEmail] || [];
      }),

      getGroupRoles: vi.fn(async (_, __, groupId) => {
        const mockGroupRoles = {
          "0": allAppRoles,
          "1": [],
          "scanner-only": [AppRoles.TICKETS_SCANNER],
        };

        return mockGroupRoles[groupId] || [];
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
