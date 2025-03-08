import { validateNetId } from "api/functions/validation.js";
import { NotImplementedError } from "common/errors/index.js";
import { FastifyPluginAsync } from "fastify";
import { ValidationError } from "zod-validation-error";

const membershipPlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.get<{
    Body: undefined;
    Querystring: { netId: string };
  }>(
    "/:netId",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            netId: {
              type: "string",
            },
          },
        },
      },
    },
    async (request, reply) => {
      const netId = (request.params as Record<string, string>).netId;
      if (!validateNetId(netId)) {
        throw new ValidationError(`${netId} is not a valid Illinois NetID!`);
      }
      throw new NotImplementedError({});
    },
  );
};

export default membershipPlugin;
