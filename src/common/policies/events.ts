import * as z from "zod/v4";
import { createPolicy } from "./evaluator.js";
import { AllOrganizationNameList, OrganizationName } from "@acm-uiuc/js-shared";
import { FastifyRequest } from "fastify";

export const hostRestrictionPolicy = createPolicy(
  "EventsHostRestrictionPolicy",
  z.object({ host: z.array(z.enum(AllOrganizationNameList)) }),
  (request: FastifyRequest & { username?: string; }, params) => {
    if (request.method === "GET") {
      return {
        allowed: true,
        message: "Skipped as route not in scope.",
        cacheKey: null
      };
    }
    if (!request.url.startsWith("/api/v1/events")) {
      return {
        allowed: true,
        message: "Skipped as route not in scope.",
        cacheKey: null
      };
    }
    const typedBody = request.body as { host: string; featured: boolean; };
    if (!typedBody || !typedBody["host"]) {
      return {
        allowed: true,
        message: "Skipped as no host found.",
        cacheKey: null
      };
    }
    if (typedBody["featured"]) {
      return {
        allowed: false,
        message: `Denied by policy "EventsHostRestrictionPolicy". Event must not be featured.`,
        cacheKey: request.username || null
      };
    }
    if (!params.host.includes(typedBody["host"] as OrganizationName)) {
      return {
        allowed: false,
        message: `Denied by policy "EventsHostRestrictionPolicy". Host must be one of: ${params.host.toString()}.`,
        cacheKey: request.username || null
      };
    }
    return {
      allowed: true,
      message: `Policy "EventsHostRestrictionPolicy". evaluated successfully.`,
      cacheKey: request.username || null
    };
  }
);
