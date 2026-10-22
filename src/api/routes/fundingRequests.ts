import { FastifyPluginAsync } from "fastify";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import * as z from "zod/v4";
import rateLimiter from "api/plugins/rateLimiter.js";
import { withRoles, withTags } from "api/components/index.js";
import { NotImplementedError } from "common/errors/index.js";

// TODO: replace [] with funding request roles once they are added to common/roles.ts.
// An empty roles list means any authenticated user can call the route.

const requestIdParams = z.object({
  requestId: z.string().min(1).meta({
    description: "Funding request ID.",
    example: "6667e095-8b04-4877-b361-f636f459ba42",
  }),
});

const fundingRequestRoutes: FastifyPluginAsync = async (fastify, _options) => {
  await fastify.register(rateLimiter, {
    limit: 20,
    duration: 30,
    rateLimitIdentifier: "fundingRequests",
  });

  // POST /fundingRequests — create a new funding request
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "",
    {
      schema: withRoles(
        [],
        withTags(["Funding Requests"], {
          summary: "Create a new funding request.",
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (_request, _reply) => {
      throw new NotImplementedError({});
    },
  );

  // GET /fundingRequests — list funding requests the user can access
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "",
    {
      schema: withRoles(
        [],
        withTags(["Funding Requests"], {
          summary: "List funding requests the user can access.",
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (_request, _reply) => {
      throw new NotImplementedError({});
    },
  );

  // GET /fundingRequests/:requestId — view one funding request
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/:requestId",
    {
      schema: withRoles(
        [],
        withTags(["Funding Requests"], {
          summary: "Get a single funding request.",
          params: requestIdParams,
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (_request, _reply) => {
      throw new NotImplementedError({});
    },
  );

  // PATCH /fundingRequests/:requestId — edit request info (requester, treasurer)
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().patch(
    "/:requestId",
    {
      schema: withRoles(
        [],
        withTags(["Funding Requests"], {
          summary: "Edit a funding request.",
          params: requestIdParams,
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (_request, _reply) => {
      throw new NotImplementedError({});
    },
  );

  // PATCH /fundingRequests/:requestId/status — update status (treasurer)
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().patch(
    "/:requestId/status",
    {
      schema: withRoles(
        [],
        withTags(["Funding Requests"], {
          summary: "Update the status of a funding request.",
          params: requestIdParams,
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (_request, _reply) => {
      throw new NotImplementedError({});
    },
  );

  // GET /fundingRequests/:requestId/history — view edit history
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/:requestId/history",
    {
      schema: withRoles(
        [],
        withTags(["Funding Requests"], {
          summary: "Get the edit history of a funding request.",
          params: requestIdParams,
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (_request, _reply) => {
      throw new NotImplementedError({});
    },
  );

  // DELETE /fundingRequests/:requestId — delete/cancel a request
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().delete(
    "/:requestId",
    {
      schema: withRoles(
        [],
        withTags(["Funding Requests"], {
          summary: "Delete or cancel a funding request.",
          params: requestIdParams,
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (_request, _reply) => {
      throw new NotImplementedError({});
    },
  );
};

export default fundingRequestRoutes;
