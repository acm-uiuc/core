import { describe, expect, test, vi } from "vitest";
import { type FastifyRequest } from "fastify";
import { evaluateAllRequestPolicies } from "../../../src/api/plugins/evaluatePolicies.js";

describe("Policy Evalulator Tests", async () => {
  test("Policy evalulation is true for non-event routes.", async () => {
    const mockRequest = {
      url: "/api/v1/healthz",
      body: {
        host: "ACM",
        featured: true,
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
  test("Policy evalulation skips GET routes.", async () => {
    const mockRequest = {
      url: "/api/v1/events/123",
      method: "GET",
      body: {
        host: "ACM",
        featured: true,
      },
      log: {
        info: vi.fn(),
      },
      username: "test@acm.illinois.edu",
      policyRestrictions: [{
        "name": "EventsHostRestrictionPolicy",
        "params": {
          "host": [
            "NONE"
          ]
        }
      }],
    } as unknown as FastifyRequest;
    const response = await evaluateAllRequestPolicies(mockRequest);
    expect(response).toBe(true);
  })
  test("Policy evalulation does not permit featured events even for the correct host.", async () => {
    const mockRequest = {
      url: "/api/v1/events",
      method: "POST",
      body: {
        host: "ACM",
        featured: true,
      },
      log: {
        info: vi.fn(),
      },
      username: "test@acm.illinois.edu",
      policyRestrictions: [{
        "name": "EventsHostRestrictionPolicy",
        "params": {
          "host": [
            "ACM"
          ]
        }
      }],
    } as unknown as FastifyRequest;
    const response = await evaluateAllRequestPolicies(mockRequest);
    expect(response).toBe(`Denied by policy "EventsHostRestrictionPolicy". Event must not be featured.`)
  })
  test("Policy evalulation denies incorrect host.", async () => {
    const mockRequest = {
      url: "/api/v1/events",
      method: "DELETE",
      body: {
        host: "ACM",
        featured: false,
      },
      log: {
        info: vi.fn(),
      },
      username: "test@acm.illinois.edu",
      policyRestrictions: [{
        "name": "EventsHostRestrictionPolicy",
        "params": {
          "host": [
            "Infrastructure Committee"
          ]
        }
      }],
    } as unknown as FastifyRequest;
    const response = await evaluateAllRequestPolicies(mockRequest);
    expect(response).toBe(`Denied by policy "EventsHostRestrictionPolicy". Host must be one of: Infrastructure Committee.`);
  })
  test("Policy evalulation permits correct host non-featured requests.", async () => {
    const mockRequest = {
      url: "/api/v1/events",
      method: "POST",
      body: {
        host: "ACM",
        featured: false,
      },
      log: {
        info: vi.fn(),
      },
      username: "test@acm.illinois.edu",
      policyRestrictions: [{
        "name": "EventsHostRestrictionPolicy",
        "params": {
          "host": [
            "ACM"
          ]
        }
      }],
    } as unknown as FastifyRequest;
    const response = await evaluateAllRequestPolicies(mockRequest);
    expect(response).toBe(true);
  })
})
