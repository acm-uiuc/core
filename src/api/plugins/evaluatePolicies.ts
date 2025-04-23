import fp from "fastify-plugin";
import { FastifyPluginAsync, FastifyRequest } from "fastify";
import { UnauthorizedError } from "../../common/errors/index.js";
import {
  AuthorizationPoliciesRegistry,
  AvailableAuthorizationPolicies,
} from "api/policies/definition.js";
import { evaluatePolicy } from "api/policies/evaluator.js";

/**
 * Evaluates all policy restrictions for a request
 * @param {FastifyRequest} request - The Fastify request object
 * @returns {Promise<boolean>} - True if all policies pass, throws error otherwise
 */
export const evaluateAllRequestPolicies = async (
  request: FastifyRequest,
): Promise<boolean | string> => {
  if (!request.policyRestrictions) {
    return true;
  }

  for (const restriction of request.policyRestrictions) {
    if (
      AuthorizationPoliciesRegistry[
        restriction.name as keyof AvailableAuthorizationPolicies
      ] === undefined
    ) {
      request.log.warn(`Invalid policy name ${restriction.name}, skipping...`);
      continue;
    }

    const policyFunction =
      AuthorizationPoliciesRegistry[
        restriction.name as keyof AvailableAuthorizationPolicies
      ];
    const policyResult = evaluatePolicy(request, {
      policy: policyFunction,
      params: restriction.params,
    });

    request.log.info(
      `Policy ${restriction.name} evaluated to ${policyResult.allowed}.`,
    );

    if (!policyResult.allowed) {
      return policyResult.message;
    }
  }

  return true;
};

/**
 * Fastify plugin to evaluate authorization policies after the request body has been parsed
 */
const evaluatePoliciesPluginAsync: FastifyPluginAsync = async (
  fastify,
  _options,
) => {
  // Register a hook that runs after body parsing but before route handler
  fastify.addHook("preHandler", async (request: FastifyRequest, _reply) => {
    const result = await evaluateAllRequestPolicies(request);
    if (typeof result === "string") {
      throw new UnauthorizedError({
        message: result,
      });
    }
  });
};

// Export the plugin as a properly wrapped fastify-plugin
export default fp(evaluatePoliciesPluginAsync, {
  name: "evaluatePolicies",
});
