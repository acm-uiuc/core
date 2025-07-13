import { FastifyPluginAsync } from "fastify";
import rateLimiter from "api/plugins/rateLimiter.js";
import { withRoles, withTags } from "api/components/index.js";
import { AppRoles } from "common/roles.js";
import * as z from "zod/v4";

const protectedRoute: FastifyPluginAsync = async (fastify, _options) => {
  await fastify.register(rateLimiter, {
    limit: 15,
    duration: 30,
    rateLimitIdentifier: "protected",
  });
  fastify.get(
    "",
    {
      schema: withRoles(
        [],
        withTags(["Generic"], {
          summary: "Get a user's roles",
          response: {
            200: {
              description: "The user's username and roles have been retrieved.",
              content: {
                "application/json": {
                  schema: z
                    .object({
                      username: z.string().min(1),
                      roles: z.array(z.enum(AppRoles)),
                    })
                    .meta({
                      example: {
                        username: "rjjones@illinois.edu",
                        roles: [
                          AppRoles.ROOM_REQUEST_CREATE,
                          AppRoles.ROOM_REQUEST_UPDATE,
                        ],
                      },
                    }),
                },
              },
            },
          },
        }),
      ),
    },
    async (request, reply) => {
      const roles = await fastify.authorize(request, reply, [], false);
      reply.send({ username: request.username, roles: Array.from(roles) });
    },
  );
};

export default protectedRoute;
