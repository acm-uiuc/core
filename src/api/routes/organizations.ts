import { FastifyPluginAsync } from "fastify";
import { AllOrganizationList } from "@acm-uiuc/js-shared";
import fastifyCaching from "@fastify/caching";
import rateLimiter from "api/plugins/rateLimiter.js";
import { withTags } from "api/components/index.js";
import { z } from "zod/v4";

const organizationsPlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.register(fastifyCaching, {
    privacy: fastifyCaching.privacy.PUBLIC,
    serverExpiresIn: 60 * 60 * 4,
    expiresIn: 60 * 60 * 4,
  });
  fastify.register(rateLimiter, {
    limit: 60,
    duration: 60,
    rateLimitIdentifier: "organizations",
  });
  fastify.get(
    "",
    {
      schema: withTags(["Generic"], {
        summary: "Get all ACM @ UIUC organizations",
        response: {
          200: {
            description: "A list of ACM @ UIUC organizations was retrieved.",
            content: {
              "application/json": {
                schema: z
                  .array(z.enum(AllOrganizationList))
                  .default(AllOrganizationList),
              },
            },
          },
        },
      }),
    },
    async (_request, reply) => {
      reply.send(AllOrganizationList);
    },
  );
};

export default organizationsPlugin;
