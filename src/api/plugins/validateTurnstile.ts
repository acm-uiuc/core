import { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { verifyTurnstileToken } from "api/functions/turnstile.js";
import { FastifyZodOpenApiSchema } from "fastify-zod-openapi";
import { TurnstileSchema } from "api/components/index.js";

const validateTurnstileTokenPlugin: FastifyPluginAsync = fp(async (fastify) => {
  fastify.decorate(
    "validateTurnstileToken",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const schema = request.routeOptions?.schema;
      if (
        !schema ||
        !("x-turnstile-required" in schema) ||
        !schema["x-turnstile-required"]
      ) {
        return;
      }
      const realSchema = schema as FastifyZodOpenApiSchema & TurnstileSchema;
      await verifyTurnstileToken({
        turnstileSecret: fastify.secretConfig.turnstile_secret_key,
        clientToken: request.headers["x-turnstile-response"],
        logger: request.log,
        requestId: request.id,
        remoteIp: request.ip,
        expectedAction: realSchema["x-turnstile-expected-action"],
        expectedHostname: realSchema["x-turnstile-expected-hostname"],
      });
    },
  );
});

export default validateTurnstileTokenPlugin;
