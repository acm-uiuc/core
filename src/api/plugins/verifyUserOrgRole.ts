import { getUserOrgRoles } from "api/functions/organizations.js";
import { UnauthorizedError } from "common/errors/index.js";
import { OrgRoleDefinition } from "common/roles.js";
import { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

const orgRolePlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.decorate(
    "verifyOrgRole",
    async (
      request: FastifyRequest,
      _reply: FastifyReply,
      validOrgRoles: OrgRoleDefinition[],
    ) => {
      const username = request.username;
      if (!username) {
        throw new UnauthorizedError({
          message: "Could not determine user identity.",
        });
      }
      const userRoles = await getUserOrgRoles({
        username,
        dynamoClient: fastify.dynamoClient,
        logger: request.log,
      });
      let isAuthorized = false;
      for (const role of userRoles) {
        if (validOrgRoles.includes(role)) {
          isAuthorized = true;
          break;
        }
      }
      if (!isAuthorized) {
        throw new UnauthorizedError({
          message: "User does not have the required role in this organization.",
        });
      }
    },
  );
};

const fastifyOrgRolePlugin = fp(orgRolePlugin);
export default fastifyOrgRolePlugin;
