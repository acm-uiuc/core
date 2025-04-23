import { z } from "zod";
import { createPolicy } from "./evaluator.js";
import { OrganizationList } from "../orgs.js";
import { FastifyRequest } from "fastify";

export const hostRestrictionPolicy = createPolicy(
  "EventsHostRestrictionPolicy",
  z.object({ host: z.array(z.enum(OrganizationList)) }),
  (request: FastifyRequest, params) => {
    if (!request.url.startsWith("/api/v1/events")) {
      return {
        allowed: true,
        message: "Skipped as route not in scope.",
        cacheKey: null,
      };
    }
    const typedBody = request.body as { host: string };
    if (!typedBody || !typedBody["host"]) {
      return {
        allowed: true,
        message: "Skipped as no host found.",
        cacheKey: null,
      };
    }
    if (!params.host.includes(typedBody["host"])) {
      return {
        allowed: false,
        message: `Denied by policy "EventsHostRestrictionPolicy".`,
        cacheKey: request.username || null,
      };
    }
    return {
      allowed: true,
      message: `Policy "EventsHostRestrictionPolicy". evaluated successfully.`,
      cacheKey: request.username || null,
    };
  },
);
