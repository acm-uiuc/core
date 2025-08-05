import * as z from "zod/v4";
import { createPolicy } from "./evaluator.js";
import { FastifyRequest } from "fastify";

export const membershipListPolicy = createPolicy(
  "MembershipListQueryPolicy",
  z.object({ list: z.array(z.string().min(1)).min(1) }),
  (request: FastifyRequest & { username?: string; }, params) => {
    if (request.method !== "GET") {
      return {
        allowed: true,
        message: "Skipped as route not in scope.",
        cacheKey: null
      };
    }
    const regex = /^\/api\/.*\/membership\/.+$/;
    if (!regex.test(request.url)) {
      return {
        allowed: true,
        message: "Skipped as route not in scope.",
        cacheKey: null
      };
    }
    let queryParams = request.query as { list: string };
    if (!queryParams || !queryParams.list) {
      queryParams = { "list": "acmpaid" }
    }
    const queriedList = queryParams.list;
    if (!params.list.includes(queriedList)) {
      return {
        allowed: false,
        message: `Denied by policy "MembershipListQueryPolicy". You are not authorized to view this list.`,
        cacheKey: request.username || null
      };
    }
    return {
      allowed: true,
      message: `Policy "MembershipListQueryPolicy" evaluated successfully.`,
      cacheKey: `${request.username}|${queriedList}`
    };
  }
);
