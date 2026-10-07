import * as z from "zod/v4";
import type pino from "pino";
import { genericConfig } from "common/config.js";
import { InternalServerError } from "common/errors/index.js";
import { AvailableSQSFunctions } from "common/types/sqsMessage.js";
import type { SQSHandlerFunction } from "../index.js";
import { getSecretConfig } from "../utils.js";

const failureMessage = "Failed to sync Cloudflare account member.";
const cloudflareId = z.string().regex(/^[0-9a-fA-F]{32}$/);
const memberConfigSchema = z.object({
  account_id: cloudflareId,
  api_token: z.string().trim().min(1),
  role_ids: z.array(cloudflareId).min(1),
});
const memberListSchema = z.object({
  result: z.array(
    z
      .object({
        id: cloudflareId,
        status: z.enum(["accepted", "pending", "rejected"]),
        email: z.email().optional(),
        user: z.object({ email: z.email() }).optional(),
      })
      .refine((member) => member.user?.email || member.email),
  ),
  result_info: z.object({ total_count: z.number().int().nonnegative() }),
});
const envelopeSchema = z
  .object({
    success: z.boolean(),
    errors: z
      .array(z.object({ code: z.number(), message: z.string() }))
      .optional(),
  })
  .passthrough();

type RequestDiagnostics = {
  httpStatus?: number;
  cloudflareErrors?: { code: number; message: string }[];
};

async function cloudflareRequest({
  url,
  method,
  apiToken,
  body,
  diagnostics,
}: {
  url: string;
  method: "GET" | "POST" | "DELETE";
  apiToken: string;
  body?: { email: string; roles: string[] };
  diagnostics: RequestDiagnostics;
}) {
  diagnostics.httpStatus = undefined;
  diagnostics.cloudflareErrors = undefined;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  diagnostics.httpStatus = response.status;
  const envelope = envelopeSchema.parse(await response.json());
  // Log only API error fields, never arbitrary response bodies or exceptions.
  diagnostics.cloudflareErrors = envelope.errors?.map(({ code, message }) => ({
    code,
    message: message.replaceAll(apiToken, "[REDACTED]"),
  }));
  if (!response.ok || !envelope.success) {
    throw new Error(failureMessage);
  }
  return envelope;
}

export async function syncCloudflareAccountMember({
  action,
  email,
  accountId,
  apiToken,
  roleIds,
  logger,
}: {
  action: "add" | "remove";
  email: string;
  accountId: string;
  apiToken: string;
  roleIds: string[];
  logger: pino.Logger;
}): Promise<void> {
  const diagnostics: RequestDiagnostics = {};
  try {
    const membersUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/members`;
    const normalizedEmail = email.toLowerCase();
    let member: z.infer<typeof memberListSchema>["result"][number] | undefined;
    let seen = 0;
    for (let page = 1; ; page++) {
      const envelope = await cloudflareRequest({
        url: `${membersUrl}?page=${page}&per_page=50`,
        method: "GET",
        apiToken,
        diagnostics,
      });
      const list = memberListSchema.parse(envelope);
      member = list.result.find(
        (entry) =>
          (entry.user?.email ?? entry.email)?.toLowerCase() === normalizedEmail,
      );
      seen += list.result.length;
      if (member || seen >= list.result_info.total_count) {
        break;
      }
      if (list.result.length === 0) {
        throw new Error(failureMessage);
      }
    }

    if (action === "add") {
      if (member?.status === "rejected") {
        throw new Error(failureMessage);
      }
      if (member) {
        logger.info(
          { action, email },
          "Cloudflare account membership already satisfied.",
        );
        return;
      }
      await cloudflareRequest({
        url: membersUrl,
        method: "POST",
        apiToken,
        body: { email, roles: roleIds },
        diagnostics,
      });
      logger.info(
        { action, email },
        "Created Cloudflare account member invitation.",
      );
      return;
    }

    if (!member) {
      logger.info(
        { action, email },
        "Cloudflare account membership already satisfied.",
      );
      return;
    }
    await cloudflareRequest({
      url: `${membersUrl}/${member.id}`,
      method: "DELETE",
      apiToken,
      diagnostics,
    });
    logger.info({ action, email }, "Removed Cloudflare account member.");
  } catch {
    logger.error({ action, email, ...diagnostics }, failureMessage);
    throw new InternalServerError({ message: failureMessage });
  }
}

export const syncCloudflareMemberHandler: SQSHandlerFunction<
  AvailableSQSFunctions.SyncCloudflareMember
> = async ({ action, email }, _metadata, logger) => {
  let config: z.infer<typeof memberConfigSchema>;
  try {
    const secretConfig = await getSecretConfig({
      logger,
      commonConfig: { region: genericConfig.AwsRegion },
    });
    config = memberConfigSchema.parse(
      JSON.parse(secretConfig.cloudflare_member_config ?? ""),
    );
  } catch {
    logger.error({ action, email }, failureMessage);
    throw new InternalServerError({ message: failureMessage });
  }
  await syncCloudflareAccountMember({
    action,
    email,
    accountId: config.account_id,
    apiToken: config.api_token,
    roleIds: config.role_ids,
    logger,
  });
};
