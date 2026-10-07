import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type pino from "pino";
import type { SecretConfig } from "../../../../src/common/config.js";
import { InternalServerError } from "../../../../src/common/errors/index.js";

vi.mock("../../../../src/api/sqs/utils.js", () => ({
  getSecretConfig: vi.fn(),
}));

import { getSecretConfig } from "../../../../src/api/sqs/utils.js";
import {
  syncCloudflareAccountMember,
  syncCloudflareMemberHandler,
} from "../../../../src/api/sqs/handlers/syncCloudflareMember.js";

const accountId = "a".repeat(32);
const memberId = "c".repeat(32);
const roleIds = ["b".repeat(32), "d".repeat(32)];
const apiToken = "private-cloudflare-test-token";
const email = "member@illinois.edu";
const membersUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/members`;
const failureMessage = "Failed to sync Cloudflare account member.";
const logger = { info: vi.fn(), error: vi.fn() };
const args = {
  accountId,
  apiToken,
  roleIds,
  email,
  logger: logger as unknown as pino.Logger,
};
const metadata = { reqId: "request-123", initiator: "operator@illinois.edu" };
const fetchMock = vi.fn<typeof fetch>();
const config = {
  account_id: accountId,
  api_token: apiToken,
  role_ids: roleIds,
};

function listResponse(result: unknown[], totalCount = result.length) {
  return Response.json({
    success: true,
    result,
    result_info: { total_count: totalCount },
  });
}

async function expectSafeFailure(
  operation: Promise<void | object>,
  httpStatus?: number,
) {
  await expect(operation).rejects.toBeInstanceOf(InternalServerError);
  expect(logger.error).toHaveBeenCalledTimes(1);
  expect(logger.error).toHaveBeenCalledWith(
    expect.objectContaining({ action: expect.any(String), email }),
    failureMessage,
  );
  if (httpStatus !== undefined) {
    expect(logger.error.mock.calls[0][0].httpStatus).toBe(httpStatus);
  }
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain(apiToken);
  expect(logger.info).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(getSecretConfig).mockResolvedValue({
    cloudflare_member_config: JSON.stringify(config),
  } as SecretConfig);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("syncCloudflareAccountMember", () => {
  test.each(["accepted", "pending"])(
    "add treats %s membership as satisfied case-insensitively",
    async (status) => {
      fetchMock.mockResolvedValueOnce(
        listResponse([
          { id: memberId, status, user: { email: "MEMBER@ILLINOIS.EDU" } },
        ]),
      );
      await syncCloudflareAccountMember({ ...args, action: "add" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  test("add resolves a membership on a later page rather than posting again", async () => {
    fetchMock
      .mockResolvedValueOnce(
        listResponse(
          [
            {
              id: "e".repeat(32),
              status: "accepted",
              user: { email: "another@illinois.edu" },
            },
          ],
          2,
        ),
      )
      .mockResolvedValueOnce(
        listResponse([{ id: memberId, status: "pending", email }], 2),
      );
    await syncCloudflareAccountMember({ ...args, action: "add" });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${membersUrl}?page=1&per_page=50`,
      `${membersUrl}?page=2&per_page=50`,
    ]);
  });

  test("add invites only after exhausting the list with exact bearer auth and roles, without status", async () => {
    fetchMock
      .mockResolvedValueOnce(
        listResponse([
          {
            id: "e".repeat(32),
            status: "accepted",
            user: { email: "another@illinois.edu" },
          },
        ]),
      )
      .mockResolvedValueOnce(Response.json({ success: true }));
    await syncCloudflareAccountMember({ ...args, action: "add" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(2, membersUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, roles: roleIds }),
      signal: expect.any(AbortSignal),
    });
  });

  test.each(["accepted", "rejected"])(
    "remove deletes an existing %s member by membership ID",
    async (status) => {
      fetchMock
        .mockResolvedValueOnce(
          listResponse([
            {
              id: memberId,
              status,
              user: { email: "MEMBER@ILLINOIS.EDU", id: "f".repeat(32) },
            },
          ]),
        )
        .mockResolvedValueOnce(Response.json({ success: true }));
      await syncCloudflareAccountMember({ ...args, action: "remove" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        `${membersUrl}/${memberId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          signal: expect.any(AbortSignal),
        },
      );
    },
  );

  test("remove stops after the final page when absent", async () => {
    fetchMock
      .mockResolvedValueOnce(
        listResponse(
          [
            {
              id: memberId,
              status: "accepted",
              user: { email: "another@illinois.edu" },
            },
          ],
          2,
        ),
      )
      .mockResolvedValueOnce(
        listResponse(
          [
            {
              id: "e".repeat(32),
              status: "pending",
              user: { email: "last@illinois.edu" },
            },
          ],
          2,
        ),
      );
    await syncCloudflareAccountMember({ ...args, action: "remove" });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${membersUrl}?page=1&per_page=50`,
      `${membersUrl}?page=2&per_page=50`,
    ]);
  });

  test("add fails instead of silently accepting a rejected invitation", async () => {
    fetchMock.mockResolvedValueOnce(
      listResponse([{ id: memberId, status: "rejected", user: { email } }]),
    );
    await expectSafeFailure(
      syncCloudflareAccountMember({ ...args, action: "add" }),
      200,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test.each([
    {
      label: "missing list",
      body: { success: true, result_info: { total_count: 0 } },
    },
    { label: "missing total count", body: { success: true, result: [] } },
    {
      label: "empty page before total count",
      body: { success: true, result: [], result_info: { total_count: 1 } },
    },
    {
      label: "missing member email",
      body: {
        success: true,
        result: [{ id: memberId, status: "accepted" }],
        result_info: { total_count: 1 },
      },
    },
  ])(
    "malformed list ($label) cannot be treated as absence",
    async ({ body }) => {
      fetchMock.mockResolvedValueOnce(Response.json(body));
      await expectSafeFailure(
        syncCloudflareAccountMember({ ...args, action: "add" }),
        200,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    { label: "network", error: new Error(`Network failure with ${apiToken}`) },
    {
      label: "timeout",
      error: new DOMException("Request timed out", "TimeoutError"),
    },
  ])("$label failure logs safely and rejects", async ({ error }) => {
    fetchMock.mockRejectedValueOnce(error);
    await expectSafeFailure(
      syncCloudflareAccountMember({ ...args, action: "add" }),
    );
  });

  test("invalid JSON logs HTTP status without logging the response body", async () => {
    fetchMock.mockResolvedValueOnce(new Response(apiToken, { status: 502 }));
    await expectSafeFailure(
      syncCloudflareAccountMember({ ...args, action: "add" }),
      502,
    );
  });

  test.each([
    { method: "GET", action: "add" as const },
    { method: "POST", action: "add" as const },
    { method: "DELETE", action: "remove" as const },
  ])(
    "$method non-2xx and success:false both reject with safe Cloudflare errors",
    async ({ method, action }) => {
      for (const status of [200, 403]) {
        logger.error.mockClear();
        if (method !== "GET") {
          fetchMock.mockResolvedValueOnce(
            listResponse(
              method === "DELETE"
                ? [{ id: memberId, status: "accepted", user: { email } }]
                : [],
            ),
          );
        }
        fetchMock.mockResolvedValueOnce(
          Response.json(
            {
              success: status !== 200,
              errors: [{ code: 10000, message: `Denied ${apiToken}` }],
            },
            { status },
          ),
        );
        await expectSafeFailure(
          syncCloudflareAccountMember({ ...args, action }),
          status,
        );
        expect(logger.error.mock.calls[0][0].cloudflareErrors).toEqual([
          { code: 10000, message: "Denied [REDACTED]" },
        ]);
      }
    },
  );
});

describe("syncCloudflareMemberHandler configuration", () => {
  test.each([
    `malformed-json-${apiToken}`,
    JSON.stringify({ ...config, account_id: `invalid-${apiToken}` }),
    JSON.stringify({ ...config, api_token: " " }),
    JSON.stringify({ ...config, role_ids: [] }),
    JSON.stringify({ ...config, role_ids: ["invalid-role"] }),
  ])(
    "invalid configuration rejects without disclosing values",
    async (cloudflare_member_config) => {
      vi.mocked(getSecretConfig).mockResolvedValueOnce({
        cloudflare_member_config,
      } as SecretConfig);
      await expectSafeFailure(
        syncCloudflareMemberHandler(
          { action: "add", email },
          metadata,
          args.logger,
        ),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  test("configuration loading failure logs no exception or secret values", async () => {
    vi.mocked(getSecretConfig).mockRejectedValueOnce(
      new Error(`SSM failure ${apiToken}`),
    );
    await expectSafeFailure(
      syncCloudflareMemberHandler(
        { action: "remove", email },
        metadata,
        args.logger,
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("operation failure is not logged twice by the wrapper", async () => {
    fetchMock.mockRejectedValueOnce(new Error(apiToken));
    await expectSafeFailure(
      syncCloudflareMemberHandler(
        { action: "add", email },
        metadata,
        args.logger,
      ),
    );
  });
});
