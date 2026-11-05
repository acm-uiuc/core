// Shared helpers for request-style modules (funding requests now, room requests later).
// Room requests still has its own inlined copies; moving it onto these is a separate PR.
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { OrganizationId } from "@acm-uiuc/js-shared";
import { UnauthorizedError } from "common/errors/index.js";
import type { AppRoles, RunEnvironment } from "common/roles.js";
import { getUserOrgRoles } from "./organizations.js";

/**
 * Throws a 403 unless the caller is a LEAD of `orgId`.
 * Anyone holding one of `bypassRoles` skips the org check.
 */
export async function assertLeadsOrg({
  fastify,
  request,
  orgId,
  action,
  bypassRoles = [],
}: {
  fastify: FastifyInstance;
  request: FastifyRequest;
  orgId: OrganizationId;
  action: string;
  bypassRoles?: AppRoles[];
}): Promise<void> {
  if (bypassRoles.some((role) => request.userRoles?.has(role))) {
    return;
  }
  if (!request.username) {
    throw new UnauthorizedError({ message: "User is not authenticated." });
  }
  const userOrgRoles = await getUserOrgRoles({
    username: request.username,
    dynamoClient: fastify.dynamoClient,
    logger: request.log,
  });
  const leadsOrg = userOrgRoles.some(
    (x) => x.org === orgId && x.role === "LEAD",
  );
  if (!leadsOrg) {
    throw new UnauthorizedError({
      message: `You must be a lead of this organization to ${action}.`,
    });
  }
}

/**
 * DynamoDB TTL value (epoch seconds) for a row that should be deleted
 * after `prodDays` in prod or `qaDays` everywhere else.
 */
export function computeExpiresAt({
  runEnvironment,
  prodDays,
  qaDays,
  now = Date.now(),
}: {
  runEnvironment: RunEnvironment;
  prodDays: number;
  qaDays: number;
  now?: number;
}): number {
  const days = runEnvironment === "prod" ? prodDays : qaDays;
  return Math.floor(now / 1000) + 86400 * days;
}
