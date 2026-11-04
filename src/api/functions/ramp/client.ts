import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { ConfigType, genericConfig, SecretConfig } from "common/config.js";
import {
  ResourceConflictError,
  ServiceUnavailableError,
  UnauthorizedError,
} from "common/errors/index.js";
import {
  RampFund,
  RampTarget,
  rampBusinessSchema,
  rampErrorResponseSchema,
  rampFundResourceSchema,
  RampFundResource,
  rampTokenResponseSchema,
  rampUserSchema,
  RampUser,
} from "common/types/stripe.js";
import { getAllUserEmails } from "common/utils.js";
import { AadToken } from "api/plugins/auth.js";
import * as z from "zod/v4";
import { getItemFromCache, insertItemIntoCache } from "../cache.js";
import { createHash } from "crypto";

const TOKEN_SCOPE = "business:read users:read funds:read funds:write";
const TOKEN_CACHE_SKEW_SECONDS = 30;
const PAGE_SIZE = 100;
const MAX_PAGES = 1_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const BUSINESS_IDENTITY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const USERS_PATH = "/developer/v1/users";
const FUNDS_PATH = "/developer/v1/funds";

// Immutable per-invocation snapshot; `deadline` bounds every remote/cache call.
export type RampProviderContext = {
  secretConfig: SecretConfig;
  environmentConfig: ConfigType;
  dynamoClient: DynamoDBClient;
  deadline: number;
};

// `creatorTenantId`/`creatorObjectId` are provenance, never a grant.
export type RampIdentity = {
  namespace: "sandbox" | "production";
  businessId: string;
  rampUserId: string;
  creatorTenantId: string;
  creatorObjectId: string;
};

export type RampTargetValidation =
  | { status: "eligible"; limitCents: number; displayName: string }
  | { status: "fund_missing" | "access_revoked" | "fund_ineligible" };

export type RampFundLimitResult = {
  status: "confirmed" | "fund_missing" | "rejected" | "unconfirmed";
  evidence?: string;
};

// ---- Private helpers ----

function namespaceForBaseUrl(baseUrl: string): "sandbox" | "production" {
  if (baseUrl === "https://demo-api.ramp.com") {
    return "sandbox";
  }
  if (baseUrl === "https://api.ramp.com") {
    return "production";
  }
  throw new ServiceUnavailableError({
    message: `Unrecognized Ramp API base URL: ${baseUrl}.`,
  });
}

function assertDeadline(context: RampProviderContext): void {
  if (Date.now() >= context.deadline) {
    throw new ServiceUnavailableError({
      message: "Ramp provider deadline exceeded.",
    });
  }
}

function cacheRequestOptions(context: RampProviderContext) {
  assertDeadline(context);
  return {
    abortSignal: AbortSignal.timeout(
      Math.max(1, context.deadline - Date.now()),
    ),
  };
}

// One bounded Ramp HTTP request: deadline-bound, size-capped body, no redirects
// so a 3xx/status-only response can never be mistaken for execution.
async function rampRequest(
  context: RampProviderContext,
  url: string,
  init: RequestInit,
): Promise<{ status: number; headers: Headers; body: unknown }> {
  assertDeadline(context);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    context.deadline - Date.now(),
  );
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "manual",
    });
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > MAX_RESPONSE_BYTES) {
      throw new ServiceUnavailableError({
        message: "Ramp response exceeded the body size limit.",
      });
    }
    const chunks: string[] = [];
    const decoder = new TextDecoder();
    let bytesRead = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          bytesRead += value.byteLength;
          if (bytesRead > MAX_RESPONSE_BYTES) {
            throw new ServiceUnavailableError({
              message: "Ramp response exceeded the body size limit.",
            });
          }
          chunks.push(decoder.decode(value, { stream: true }));
        }
        chunks.push(decoder.decode());
      } finally {
        reader.releaseLock();
      }
    }
    const text = chunks.join("");
    let body: unknown;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = undefined;
      }
    }
    assertDeadline(context);
    return { status: response.status, headers: response.headers, body };
  } catch (error) {
    if (error instanceof ServiceUnavailableError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new ServiceUnavailableError({
        message: "Ramp provider request timed out.",
      });
    }
    throw new ServiceUnavailableError({
      message: "Ramp provider request failed.",
    });
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

// One client-credentials session: cached access token plus the integration's
// immutable business id, both keyed by URL and credential digest.
async function acquireSession(
  context: RampProviderContext,
): Promise<{ token: string; businessId: string }> {
  const clientId = context.secretConfig.ramp_client_id;
  const clientSecret = context.secretConfig.ramp_client_secret;
  if (!clientId || !clientSecret) {
    throw new ServiceUnavailableError({
      message: "Ramp client credentials are not configured.",
    });
  }
  const baseUrl = context.environmentConfig.RampApiBaseUrl;
  // Hash the tuple so separators cannot alias two credential pairs.
  const digest = createHash("sha256")
    .update(JSON.stringify([clientId, clientSecret]))
    .digest("hex");

  const tokenKey = `ramp_access_token_${baseUrl}_${digest}`;
  const cachedToken = await getItemFromCache(
    context.dynamoClient,
    tokenKey,
    cacheRequestOptions(context),
  ).catch(() => {
    throw new ServiceUnavailableError({
      message: "Ramp token cache unavailable.",
    });
  });
  let token: string;
  if (cachedToken && typeof cachedToken.token === "string") {
    token = cachedToken.token;
  } else {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64",
    );
    const { status, body } = await rampRequest(
      context,
      `${baseUrl}/developer/v1/token`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          grant_type: "client_credentials",
          scope: TOKEN_SCOPE,
        }),
      },
    );
    if (status !== 200) {
      throw new ServiceUnavailableError({
        message: `Ramp token acquisition failed (HTTP ${status}).`,
      });
    }
    const parsed = rampTokenResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ServiceUnavailableError({
        message: "Ramp token response was malformed.",
      });
    }
    const expireAt = new Date(
      Date.now() + (parsed.data.expires_in - TOKEN_CACHE_SKEW_SECONDS) * 1000,
    );
    await insertItemIntoCache(
      context.dynamoClient,
      tokenKey,
      { token: parsed.data.access_token },
      expireAt,
      cacheRequestOptions(context),
    ).catch(() => {
      throw new ServiceUnavailableError({
        message: "Ramp token cache unavailable.",
      });
    });
    token = parsed.data.access_token;
  }

  const businessKey = `ramp_business_${baseUrl}_${digest}`;
  const cachedBusiness = await getItemFromCache(
    context.dynamoClient,
    businessKey,
    cacheRequestOptions(context),
  ).catch(() => {
    throw new ServiceUnavailableError({
      message: "Ramp business cache unavailable.",
    });
  });
  let businessId: string;
  if (cachedBusiness && typeof cachedBusiness.businessId === "string") {
    businessId = cachedBusiness.businessId;
  } else {
    const { status, body } = await rampRequest(
      context,
      `${baseUrl}/developer/v1/business`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (status !== 200) {
      throw new ServiceUnavailableError({
        message: `Ramp business lookup failed (HTTP ${status}).`,
      });
    }
    const parsed = rampBusinessSchema.safeParse(body);
    if (!parsed.success) {
      throw new ServiceUnavailableError({
        message: "Ramp business response was malformed.",
      });
    }
    await insertItemIntoCache(
      context.dynamoClient,
      businessKey,
      { businessId: parsed.data.id },
      new Date(Date.now() + BUSINESS_IDENTITY_TTL_MS),
      cacheRequestOptions(context),
    ).catch(() => {
      throw new ServiceUnavailableError({
        message: "Ramp business cache unavailable.",
      });
    });
    businessId = parsed.data.id;
  }

  return { token, businessId };
}

// Fail closed on any next-page URL that is not the exact configured endpoint,
// path, and required filters: a foreign or filter-dropping page must never
// produce a silently partial list.
function assertNextPageUrl(
  next: string,
  baseUrl: string,
  path: string,
  requiredFilters: Record<string, string>,
): void {
  let parsed: URL;
  try {
    parsed = new URL(next);
  } catch {
    throw new ServiceUnavailableError({
      message: "Ramp returned a malformed next-page URL.",
    });
  }
  const base = new URL(baseUrl);
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== base.origin ||
    parsed.pathname !== path
  ) {
    throw new ServiceUnavailableError({
      message: "Ramp next-page URL did not match the configured endpoint.",
    });
  }
  for (const [key, value] of Object.entries(requiredFilters)) {
    if (parsed.searchParams.get(key) !== value) {
      throw new ServiceUnavailableError({
        message: `Ramp next-page URL dropped required filter ${key}.`,
      });
    }
  }
}

async function fetchAllPages<S extends z.ZodTypeAny>(
  context: RampProviderContext,
  token: string,
  path: string,
  requiredFilters: Record<string, string>,
  itemSchema: S,
): Promise<z.infer<S>[]> {
  const baseUrl = context.environmentConfig.RampApiBaseUrl;
  const params = new URLSearchParams({
    page_size: String(PAGE_SIZE),
    ...requiredFilters,
  });
  const firstUrl = `${baseUrl}${path}?${params.toString()}`;
  const collected: z.infer<S>[] = [];
  let next: string | null = firstUrl;
  for (let page = 0; page < MAX_PAGES && next !== null; page++) {
    assertDeadline(context);
    assertNextPageUrl(next, baseUrl, path, requiredFilters);
    const { status, body } = await rampRequest(context, next, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (status !== 200) {
      throw new ServiceUnavailableError({
        message: `Ramp list request failed (HTTP ${status}).`,
      });
    }
    const parsed = z
      .object({
        data: z.array(itemSchema),
        page: z.object({ next: z.string().nullable() }),
      })
      .safeParse(body);
    if (!parsed.success) {
      throw new ServiceUnavailableError({
        message: "Ramp list response was malformed.",
      });
    }
    collected.push(...parsed.data.data);
    next = parsed.data.page.next;
  }
  if (next !== null) {
    throw new ServiceUnavailableError({
      message: "Ramp pagination exceeded its bounded page count.",
    });
  }
  return collected;
}

async function fetchResource<T extends z.ZodTypeAny>(
  context: RampProviderContext,
  token: string,
  path: string,
  resource: "user" | "fund",
  schema: T,
): Promise<z.infer<T> | null> {
  const { status, body } = await rampRequest(context, path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (status === 404 && rampErrorResponseSchema.safeParse(body).success) {
    return null;
  }
  if (status !== 200) {
    throw new ServiceUnavailableError({
      message: `Ramp ${resource} lookup failed (HTTP ${status}).`,
    });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ServiceUnavailableError({
      message: `Ramp ${resource} response was malformed.`,
    });
  }
  return parsed.data;
}

function assertNamespace(
  context: RampProviderContext,
  namespace: string,
): void {
  const currentNamespace = namespaceForBaseUrl(
    context.environmentConfig.RampApiBaseUrl,
  );
  if (namespace !== currentNamespace) {
    throw new ServiceUnavailableError({
      message: `Ramp namespace drifted from ${namespace} to ${currentNamespace}.`,
    });
  }
}

function isEligibleFund(fund: RampFundResource): boolean {
  if (fund.state !== "ACTIVE") {
    return false;
  }
  const restrictions = fund.spending_restrictions;
  if (restrictions === null) {
    return false;
  }
  if (restrictions.interval !== "TOTAL") {
    return false;
  }
  if (restrictions.temporary_limit !== null) {
    return false;
  }
  const limit = restrictions.limit;
  if (limit === null) {
    return false;
  }
  if (limit.currency_code !== "USD") {
    return false;
  }
  return Number.isSafeInteger(limit.amount) && limit.amount >= 0;
}

function isAdministrator(user: RampUser): boolean {
  return user.role === "BUSINESS_ADMIN" || user.role === "BUSINESS_OWNER";
}

// The one management predicate shared by listing and validation.
function userHasFundAccess(
  user: RampUser,
  fund: RampFundResource,
  appearsInOwnerFilteredList: boolean,
): boolean {
  if (user.status !== "USER_ACTIVE") {
    return false;
  }
  if (isAdministrator(user)) {
    return true;
  }
  if (!appearsInOwnerFilteredList) {
    return false;
  }
  const membership = fund.members.find((member) => member.user_id === user.id);
  return membership !== undefined && membership.suspension === null;
}

// ---- Exported provider operations ----

// Resolve a verified Entra token to its matching active Ramp user, or null.
export async function resolveRampIdentity({
  context,
  tokenPayload,
}: {
  context: RampProviderContext;
  tokenPayload: AadToken | undefined;
}): Promise<RampIdentity | null> {
  if (!tokenPayload) {
    throw new UnauthorizedError({
      message: "Personal Ramp selection requires a verified user token.",
    });
  }
  const { oid, tid, iss, email, upn } = tokenPayload;
  const expectedIssuers = [
    `https://sts.windows.net/${genericConfig.EntraTenantId}/`,
    `https://login.microsoftonline.com/${genericConfig.EntraTenantId}/v2.0`,
  ];
  if (!z.uuid().safeParse(oid).success) {
    throw new UnauthorizedError({
      message: "Ramp selection requires a valid user object id.",
    });
  }
  if (tid !== genericConfig.EntraTenantId || !expectedIssuers.includes(iss)) {
    throw new UnauthorizedError({
      message: "Ramp selection requires a token from the configured tenant.",
    });
  }
  if (!email && !upn) {
    throw new UnauthorizedError({
      message: "Ramp selection requires an email or UPN claim.",
    });
  }

  const { token, businessId } = await acquireSession(context);
  const namespace = namespaceForBaseUrl(
    context.environmentConfig.RampApiBaseUrl,
  );

  const aliases = new Set<string>();
  for (const raw of [email, upn]) {
    if (!raw) {
      continue;
    }
    const normalized = raw.trim().toLowerCase();
    aliases.add(normalized);
    for (const alias of getAllUserEmails(normalized)) {
      aliases.add(alias);
    }
  }

  const matches = new Map<string, RampUser>();
  for (const alias of aliases) {
    const users = await fetchAllPages(
      context,
      token,
      USERS_PATH,
      { email: alias },
      rampUserSchema,
    );
    for (const user of users) {
      if (user.email.trim().toLowerCase() === alias) {
        matches.set(user.id, user);
      }
    }
  }

  if (matches.size === 0) {
    return null;
  }
  if (matches.size > 1) {
    throw new ResourceConflictError({
      message: "Multiple Ramp users match this account.",
    });
  }
  const user = matches.values().next().value;
  if (
    !user ||
    user.status !== "USER_ACTIVE" ||
    user.business_id === null ||
    user.business_id !== businessId
  ) {
    return null;
  }

  return {
    namespace,
    businessId,
    rampUserId: user.id,
    creatorTenantId: tid,
    creatorObjectId: oid,
  };
}

// Eligible funds an identity may target: admins/owners see all; others only
// funds where they hold unsuspended OWNER/COOWNER membership.
export async function listEligibleRampFunds({
  context,
  identity,
}: {
  context: RampProviderContext;
  identity: RampIdentity;
}): Promise<RampFund[]> {
  assertNamespace(context, identity.namespace);
  const { token, businessId } = await acquireSession(context);
  if (businessId !== identity.businessId) {
    throw new ServiceUnavailableError({
      message: "Ramp integration business drifted.",
    });
  }
  const user = await fetchResource(
    context,
    token,
    `${context.environmentConfig.RampApiBaseUrl}${USERS_PATH}/${identity.rampUserId}`,
    "user",
    rampUserSchema,
  );
  if (
    !user ||
    user.status !== "USER_ACTIVE" ||
    user.business_id !== businessId
  ) {
    return [];
  }

  const admin = isAdministrator(user);
  const funds = admin
    ? await fetchAllPages(
        context,
        token,
        FUNDS_PATH,
        {},
        rampFundResourceSchema,
      )
    : await fetchAllPages(
        context,
        token,
        FUNDS_PATH,
        { user_id: identity.rampUserId, member_roles: "OWNER,COOWNER" },
        rampFundResourceSchema,
      );

  return funds
    .filter((fund) => isEligibleFund(fund))
    .filter((fund) => userHasFundAccess(user, fund, !admin))
    .map((fund) => ({ id: fund.id, displayName: fund.display_name }));
}

// Freshly revalidate a pinned target: namespace/business must still match,
// the fund must exist and be eligible, and the user must still hold access.
export async function validateRampTarget({
  context,
  target,
}: {
  context: RampProviderContext;
  target: RampTarget;
}): Promise<RampTargetValidation> {
  assertNamespace(context, target.namespace);
  const { token, businessId } = await acquireSession(context);
  if (businessId !== target.businessId) {
    throw new ServiceUnavailableError({
      message: "Ramp integration business drifted.",
    });
  }

  const baseUrl = context.environmentConfig.RampApiBaseUrl;
  const fund = await fetchResource(
    context,
    token,
    `${baseUrl}${FUNDS_PATH}/${target.fundId}`,
    "fund",
    rampFundResourceSchema,
  );
  if (fund === null || fund.state === "TERMINATED") {
    return { status: "fund_missing" };
  }
  if (!isEligibleFund(fund)) {
    return { status: "fund_ineligible" };
  }

  const user = await fetchResource(
    context,
    token,
    `${baseUrl}${USERS_PATH}/${target.rampUserId}`,
    "user",
    rampUserSchema,
  );
  if (
    !user ||
    user.status !== "USER_ACTIVE" ||
    user.business_id !== businessId
  ) {
    return { status: "access_revoked" };
  }

  const admin = isAdministrator(user);
  let appearsInOwnerFilteredList = false;
  if (!admin) {
    const ownerFunds = await fetchAllPages(
      context,
      token,
      FUNDS_PATH,
      { user_id: target.rampUserId, member_roles: "OWNER,COOWNER" },
      rampFundResourceSchema,
    );
    appearsInOwnerFilteredList = ownerFunds.some(
      (candidate) => candidate.id === target.fundId,
    );
  }
  if (!userHasFundAccess(user, fund, appearsInOwnerFilteredList)) {
    return { status: "access_revoked" };
  }

  const limit = fund.spending_restrictions?.limit;
  if (!limit) {
    // isEligibleFund guarantees a finite USD limit; the type is nullable.
    throw new ServiceUnavailableError({
      message: "Eligible fund is missing its limit.",
    });
  }
  return {
    status: "eligible",
    limitCents: limit.amount,
    displayName: fund.display_name,
  };
}

// Set an absolute fund limit. No automatic PATCH retry: timeout/5xx/lost
// connection/redirect/malformed 2xx is unconfirmed. Evidence never carries
// credentials.
export async function setRampFundLimit({
  context,
  target,
  amountCents,
  idempotencyKey,
}: {
  context: RampProviderContext;
  target: RampTarget;
  amountCents: number;
  idempotencyKey: string;
}): Promise<RampFundLimitResult> {
  if (
    !Number.isSafeInteger(amountCents) ||
    amountCents < 0 ||
    idempotencyKey.length === 0 ||
    idempotencyKey.length > 255
  ) {
    return {
      status: "rejected",
      evidence: "Invalid limit or idempotency key; no PATCH dispatched.",
    };
  }
  if (
    target.namespace === "production" &&
    context.secretConfig.ramp_credits_enabled !== true
  ) {
    return {
      status: "rejected",
      evidence: "Production Ramp credits are disabled; no PATCH dispatched.",
    };
  }
  let token: string;
  let businessId: string;
  try {
    assertNamespace(context, target.namespace);
    const session = await acquireSession(context);
    token = session.token;
    businessId = session.businessId;
  } catch (error) {
    return {
      status: "rejected",
      evidence:
        error instanceof Error
          ? error.message
          : "Pre-write provider check failed.",
    };
  }
  if (businessId !== target.businessId) {
    return {
      status: "rejected",
      evidence: "Ramp integration business drifted before write.",
    };
  }

  if (Date.now() >= context.deadline) {
    return {
      status: "rejected",
      evidence: "Provider deadline expired; no PATCH dispatched.",
    };
  }
  const url = `${context.environmentConfig.RampApiBaseUrl}${FUNDS_PATH}/${target.fundId}`;
  let response: { status: number; headers: Headers; body: unknown };
  try {
    response = await rampRequest(context, url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        spending_restrictions: {
          limit: { amount: amountCents, currency_code: "USD" },
        },
      }),
    });
  } catch (error) {
    return {
      status: "unconfirmed",
      evidence:
        error instanceof Error ? error.message : "PATCH request failed.",
    };
  }

  const traceId = response.headers.get("x-trace-id")?.slice(0, 512);
  const evidence = (extra?: Record<string, unknown>): string =>
    JSON.stringify({ httpStatus: response.status, traceId, ...extra });

  const parsedError = rampErrorResponseSchema.safeParse(response.body);
  // Documented validation/auth/resource errors prove rejection only with a
  // structured provider response. Bare/intermediary 4xx and 429 stay uncertain.
  if (parsedError.success && response.status === 404) {
    return {
      status: "fund_missing",
      evidence: evidence({ errorCode: parsedError.data.error_v2.error_code }),
    };
  }
  if (
    parsedError.success &&
    (response.status === 400 ||
      response.status === 401 ||
      response.status === 403 ||
      response.status === 422)
  ) {
    return {
      status: "rejected",
      evidence: evidence({ errorCode: parsedError.data.error_v2.error_code }),
    };
  }
  if (response.status !== 200) {
    // Includes redirects: a 3xx/status-only response cannot prove non-execution.
    return { status: "unconfirmed", evidence: evidence() };
  }

  const parsed = rampFundResourceSchema.safeParse(response.body);
  if (!parsed.success || parsed.data.id !== target.fundId) {
    return {
      status: "unconfirmed",
      evidence: evidence({ reason: "malformed or mismatched fund response" }),
    };
  }
  const limit = parsed.data.spending_restrictions?.limit;
  if (
    limit === null ||
    limit === undefined ||
    limit.currency_code !== "USD" ||
    limit.amount !== amountCents
  ) {
    return {
      status: "unconfirmed",
      evidence: evidence({ reason: "unconfirmed limit value" }),
    };
  }
  return { status: "confirmed", evidence: evidence() };
}
