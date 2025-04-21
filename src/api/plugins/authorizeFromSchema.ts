import { FastifyPluginAsync } from "fastify";
import { AppRoles } from "common/roles.js";
import { InternalServerError } from "common/errors/index.js";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyInstance {
    authorizeFromSchema: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }
}

const authorizeFromSchemaPlugin: FastifyPluginAsync = fp(async (fastify) => {
  fastify.decorate("authorizeFromSchema", async (request, reply) => {
    const schema = request.routeOptions?.schema;

    if (!schema || !("x-required-roles" in schema)) {
      throw new InternalServerError({
        message:
          "Server has not specified authentication roles for this route.",
      });
    }

    const roles = (schema as { "x-required-roles": AppRoles[] })[
      "x-required-roles"
    ];
    await fastify.authorize(request, reply, roles);
  });
});

export default authorizeFromSchemaPlugin;
