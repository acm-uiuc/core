import { FastifyRequest } from "fastify";
import { hostRestrictionPolicy } from "./events.js";
import { z } from "zod";
import { AuthorizationPolicyResult } from "./evaluator.js";
type Policy<TParamsSchema extends z.ZodObject<any>> = {
  name: string;
  paramsSchema: TParamsSchema;
  evaluator: (
    request: FastifyRequest,
    params: z.infer<TParamsSchema>,
  ) => AuthorizationPolicyResult;
};

// Type to get parameters type from a policy
type PolicyParams<T> = T extends Policy<infer U> ? z.infer<U> : never;

// Type for a registry of policies
type PolicyRegistry = {
  [key: string]: Policy<any>;
};

// Type to generate a strongly-typed version of the policy registry
type TypedPolicyRegistry<T extends PolicyRegistry> = {
  [K in keyof T]: {
    name: T[K]["name"];
    params: PolicyParams<T[K]>;
  };
};

export type AvailableAuthorizationPolicies = TypedPolicyRegistry<
  typeof AuthorizationPoliciesRegistry
>;
export const AuthorizationPoliciesRegistry = {
  EventsHostRestrictionPolicy: hostRestrictionPolicy,
} as const;

export type AvailableAuthorizationPolicy = {
  [K in keyof typeof AuthorizationPoliciesRegistry]: {
    name: K;
    params: PolicyParams<(typeof AuthorizationPoliciesRegistry)[K]>;
  };
}[keyof typeof AuthorizationPoliciesRegistry];
