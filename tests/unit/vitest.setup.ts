import { vi } from "vitest";
import { allAppRoles, AppRoles } from "../../src/common/roles.js";
import { group } from "console";

vi.mock(
  import("../../src/api/functions/authorization.js"),
  async (importOriginal) => {
    const mod = await importOriginal();
    return {
      ...mod,
      getUserRoles: vi.fn(async (_, __, userEmail) => {
        const mockUserRoles = {
          "infra-unit-test-nogrp@acm.illinois.edu": [AppRoles.TICKETS_SCANNER],
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
