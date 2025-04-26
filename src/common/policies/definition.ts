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

type PolicyParams<T> = T extends Policy<infer U> ? z.infer<U> : never;

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

export const AuthorizationPoliciesRegistry: PolicyRegistry = {
  EventsHostRestrictionPolicy: hostRestrictionPolicy,
} as const;

export type AvailableAuthorizationPolicies = TypedPolicyRegistry<
  typeof AuthorizationPoliciesRegistry
>;

export type AvailableAuthorizationPolicy = {
  name: keyof typeof AuthorizationPoliciesRegistry;
  params: PolicyParams<typeof AuthorizationPoliciesRegistry[keyof typeof AuthorizationPoliciesRegistry]>;
};
