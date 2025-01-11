import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AppRoles } from "../../common/roles.js";
import { NotImplementedError } from "../../common/errors/index.js";
import { intersection } from "../plugins/auth.js";
import { NoDataRequest } from "../types.js";

type LinkrySlugOnlyRequest = {
  Params: { id: string };
  Querystring: undefined;
  Body: undefined;
};

const rawRequest = {
  slug: z.string().min(1),
  full: z.string().url().min(1),
  groups: z.optional(z.array(z.string()).min(1)),
};

const createRequest = z.object(rawRequest);
const patchRequest = z.object({ ...rawRequest, slug: z.undefined() });

type LinkyCreateRequest = {
  Params: undefined;
  Querystring: undefined;
  Body: z.infer<typeof createRequest>;
};

type LinkryPatchRequest = {
  Params: { id: string };
  Querystring: undefined;
  Body: z.infer<typeof patchRequest>;
};

const linkryRoutes: FastifyPluginAsync = async (fastify, _options) => {
  fastify.get<LinkrySlugOnlyRequest>("/redir/:id", async (request, reply) => {
    throw new NotImplementedError({});
  });
  fastify.post<LinkyCreateRequest>(
    "/redir",
    {
      preValidation: async (request, reply) => {
        await fastify.zodValidateBody(request, reply, createRequest);
      },
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [
          AppRoles.LINKS_MANAGER,
          AppRoles.LINKS_ADMIN,
        ]);
      },
    },
    async (request, reply) => {
      throw new NotImplementedError({});
    },
  );
  fastify.patch<LinkryPatchRequest>(
    "/redir/:id",
    {
      preValidation: async (request, reply) => {
        await fastify.zodValidateBody(request, reply, patchRequest);
      },
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [
          AppRoles.LINKS_MANAGER,
          AppRoles.LINKS_ADMIN,
        ]);
      },
    },
    async (request, reply) => {
      // make sure that a user can manage this link, either via owning or being in a group that has access to it, or is a LINKS_ADMIN.
      throw new NotImplementedError({});
    },
  );
  fastify.delete<LinkrySlugOnlyRequest>(
    "/redir/:id",
    {
      preValidation: async (request, reply) => {
        await fastify.zodValidateBody(request, reply, createRequest);
      },
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [
          AppRoles.LINKS_MANAGER,
          AppRoles.LINKS_ADMIN,
        ]);
      },
    },
    async (request, reply) => {
      // make sure that a user can manage this link, either via owning or being in a group that has access to it, or is a LINKS_ADMIN.
      throw new NotImplementedError({});
    },
  );
  fastify.get<NoDataRequest>(
    "/redir",
    {
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [
          AppRoles.LINKS_MANAGER,
          AppRoles.LINKS_ADMIN,
        ]);
      },
    },
    async (request, reply) => {
      // if an admin, show all links
      // if a links manager, show all my links + links I can manage
      throw new NotImplementedError({});
    },
  );
};

export default linkryRoutes;
