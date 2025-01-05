import { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import {
  InternalServerError,
  ValidationError,
} from "../../common/errors/index.js";
import { z, ZodError } from "zod";
import { fromError } from "zod-validation-error";

const zodValidationPlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.decorate(
    "zodValidateBody",
    async function (
      request: FastifyRequest,
      _reply: FastifyReply,
      zodSchema: z.ZodTypeAny,
    ): Promise<void> {
      try {
        await zodSchema.parseAsync(request.body);
      } catch (e: unknown) {
        if (e instanceof ZodError) {
          throw new ValidationError({
            message: fromError(e).toString().replace("Validation error: ", ""),
          });
        } else if (e instanceof Error) {
          request.log.error(`Error validating request body: ${e.toString()}`);
          throw new InternalServerError({
            message: "Could not validate request body.",
          });
        }
        throw e;
      }
    },
  );
};

const fastifyZodValidationPlugin = fp(zodValidationPlugin);
export default fastifyZodValidationPlugin;
