import { z } from "zod";
import { FastifyRequest } from "fastify";

export const AuthorizationPolicyResultSchema = z.object({
  allowed: z.boolean(),
  message: z.string(),
  cacheKey: z.string().nullable(),
});
export type AuthorizationPolicyResult = z.infer<
  typeof AuthorizationPolicyResultSchema
>;

export function createPolicy<TParamsSchema extends z.ZodObject<any>>(
  name: string,
  paramsSchema: TParamsSchema,
  evaluatorFn: (
    request: FastifyRequest,
    params: z.infer<TParamsSchema>,
  ) => AuthorizationPolicyResult,
) {
  return {
    name,
    paramsSchema,
    evaluator: evaluatorFn,
  };
}

export function applyPolicy<TParamsSchema extends z.ZodObject<any>>(
  policy: {
    name: string;
    paramsSchema: TParamsSchema;
    evaluator: (
      request: FastifyRequest,
      params: z.infer<TParamsSchema>,
    ) => AuthorizationPolicyResult;
  },
  params: Record<string, string>,
) {
  // Validate and transform parameters using the schema
  const validatedParams = policy.paramsSchema.parse(params);

  return {
    policy,
    params: validatedParams,
  };
}

export function evaluatePolicy<TParamsSchema extends z.ZodObject<any>>(
  request: FastifyRequest,
  policyConfig: {
    policy: {
      name: string;
      paramsSchema: TParamsSchema;
      evaluator: (
        request: FastifyRequest,
        params: z.infer<TParamsSchema>,
      ) => AuthorizationPolicyResult;
    };
    params: z.infer<TParamsSchema>;
  },
): AuthorizationPolicyResult {
  try {
    return policyConfig.policy.evaluator(request, policyConfig.params);
  } catch (error: any) {
    return {
      cacheKey: `error:${policyConfig.policy.name}:${error.message}`,
      allowed: false,
      message: `Error evaluating policy ${policyConfig.policy.name}: ${error.message}`,
    };
  }
}
