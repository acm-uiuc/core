import { FastifyPluginAsync, FastifyReply } from "fastify";
import { InternalServerError } from "common/errors/index.js";
import fp from "fastify-plugin";
import { FastifyZodOpenApiSchema } from "fastify-zod-openapi";
import { RoleSchema } from "api/components/index.js";

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
    if (!schema || !("x-disable-api-key-auth" in schema)) {
      throw new InternalServerError({
        message:
          "Server has not specified available authentication methods for this route.",
      });
    }
    const realSchema = schema as FastifyZodOpenApiSchema & RoleSchema;
    const roles = realSchema["x-required-roles"];
    const disableApiKeyAuth = realSchema["x-disable-api-key-auth"];
    await fastify.authorize(request, reply, roles, disableApiKeyAuth);
  });
});

export default authorizeFromSchemaPlugin;
