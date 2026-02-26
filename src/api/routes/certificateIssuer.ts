import { FastifyPluginAsync } from "fastify";
import { withRoles, withTags } from "api/components/index.js";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import * as z from "zod/v4";
import { assertAuthenticated } from "api/authenticated.js";
import { NotImplementedError } from "common/errors/index.js";

const certificateIssuerRoutes: FastifyPluginAsync = async (
  fastify,
  _options,
) => {
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/ssh",
    {
      schema: withRoles(
        [],
        withTags(["Certificate Issuer"], {
          body: z.undefined(),
          summary: "Issue an emphemeral SSH certificate.",
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (_request, _reply) => {
      throw new NotImplementedError({});
    }),
  );
};

export default certificateIssuerRoutes;
