import { FastifyRequest, FastifyReply } from "fastify";
import { AuthenticatedRequest } from "./types.js";
import { AuthenticationError } from "common/errors/index.js";

/**
 * Ensure at runtime that the authentication hook was run.
 * Without this, we have to assert to the type checker with `request.username!`
 * Pass the route handler into this function and the type checker will be satisfied.
 */
export function assertAuthenticated<
  TRequest extends FastifyRequest,
  TReply extends FastifyReply,
>(
  handler: (
    request: TRequest & AuthenticatedRequest,
    reply: TReply,
  ) => Promise<unknown>,
): (request: TRequest, reply: TReply) => Promise<unknown> {
  return (request, reply) => {
    if (!request.username || !request.userRoles) {
      throw new AuthenticationError({
        message:
          "Expected authentication to be performed but was not. Ensure that authorizeFromSchema is set in route definition.",
      });
    }
    return handler(request as TRequest & AuthenticatedRequest, reply);
  };
}
