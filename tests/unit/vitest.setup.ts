import { vi } from "vitest";
import { allAppRoles, AppRoles } from "../../src/common/roles.js";

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
