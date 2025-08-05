import { describe, expect, test, vi } from "vitest";
import { type FastifyRequest } from "fastify";
import { evaluateAllRequestPolicies } from "../../../src/api/plugins/evaluatePolicies.js";
import init from "../../../src/api/index.js";

describe("Policy Evalulator Tests", async () => {
  test("Policy evalulation is true for non-membership routes.", async () => {
    const mockRequest = {
      url: "/api/v1/healthz",
      query: {
        list: "noone"
      },
      log: {
        info: vi.fn(),
      },
      username: "test@acm.illinois.edu",
      policyRestrictions: [],
    } as unknown as FastifyRequest;
    const response = await evaluateAllRequestPolicies(mockRequest);
    expect(response).toBe(true);
  })
  test("Policy evalulation skips POST routes.", async () => {
    const mockRequest = {
      url: "/api/v1/membership",
      query: {
        list: "built"
      },
      method: "POST",
      log: {
        info: vi.fn(),
      },
      username: "test@acm.illinois.edu",
      policyRestrictions: [{
        "name": "MembershipListQueryPolicy",
        "params": {
          "list": [
            "noone"
          ]
        }
      }],
    } as unknown as FastifyRequest;
    const response = await evaluateAllRequestPolicies(mockRequest);
    expect(response).toBe(true);
  })
  test("Policy evalulation denies membership query for the wrong list.", async () => {
    const mockRequest = {
      url: "/api/v1/membership/sm14",
      query: {
        list: "built"
      },
      method: "GET",
      log: {
        info: vi.fn(),
      },
      username: "test@acm.illinois.edu",
      policyRestrictions: [{
        "name": "MembershipListQueryPolicy",
        "params": {
          "list": [
            "noone"
          ]
        }
      }],
    } as unknown as FastifyRequest;
    const response = await evaluateAllRequestPolicies(mockRequest);
    expect(response).toBe(`Denied by policy "MembershipListQueryPolicy". You are not authorized to view this list.`)
  })
  test("Policy evalulation allows correct list.", async () => {
    const mockRequest = {
      url: "/api/v1/membership/sm14",
      query: {
        list: "noone"
      },
      method: "GET",
      log: {
        info: vi.fn(),
      },
      username: "test@acm.illinois.edu",
      policyRestrictions: [{
        "name": "MembershipListQueryPolicy",
        "params": {
          "list": [
            "noone"
          ]
        }
      }],
    } as unknown as FastifyRequest;
    const response = await evaluateAllRequestPolicies(mockRequest);
    expect(response).toBe(true);
  })
})
