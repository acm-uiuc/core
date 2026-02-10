import { FastifyPluginAsync } from "fastify";
import rateLimiter from "api/plugins/rateLimiter.js";
import { withRoles, withTags } from "api/components/index.js";
import { getUserOrgRoles } from "api/functions/organizations.js";
import { UnauthenticatedError } from "common/errors/index.js";
import z from "zod";
import { AppRoles, orgRoles } from "common/roles.js";
import { OrgUniqueId } from "common/types/generic.js";
import { Organizations } from "@acm-uiuc/js-shared";

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
          summary: "Get a user's username and roles.",
          response: {
            200: {
              description: "The user's information was retrieved.",
              content: {
                "application/json": {
                  schema: z.object({
                    username: z.string().min(1),
                    roles: z.array(z.enum(AppRoles)).meta({
                      description: "A list of application roles the user has.",
                    }),
                    orgRoles: z
                      .array(
                        z.object({
                          org: OrgUniqueId,
                          role: z.enum(orgRoles),
                        }),
                      )
                      .meta({
                        description:
                          "A list of roles that the user has in various ACM sub-organizations.",
                      }),
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
      const { username, log: logger } = request;
      const { dynamoClient } = fastify;
      if (!username) {
        throw new UnauthenticatedError({ message: "Username not found." });
      }
      const orgRoles = await getUserOrgRoles({
        username,
        dynamoClient,
        logger,
      });

      reply.send({
        username: request.username,
        roles: Array.from(roles).filter((x) =>
          Object.values(AppRoles).includes(x),
        ),
        orgRoles: orgRoles.filter((x) =>
          Object.keys(Organizations).includes(x.org),
        ),
      });
    },
  );
};

export default protectedRoute;
