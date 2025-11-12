import { FastifyPluginAsync } from "fastify";
import rateLimiter from "api/plugins/rateLimiter.js";
import { withRoles, withTags } from "api/components/index.js";
import { getUserOrgRoles } from "api/functions/organizations.js";
import {
  UnauthenticatedError,
  UnauthorizedError,
  ValidationError,
} from "common/errors/index.js";
import * as z from "zod/v4";
import { verifyUiucAccessToken } from "api/functions/uin.js";
import { checkPaidMembership } from "api/functions/membership.js";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";

const rsvpRoutes: FastifyPluginAsync = async (fastify, _options) => {
  await fastify.register(rateLimiter, {
    limit: 30,
    duration: 30,
    rateLimitIdentifier: "rsvp",
  });
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/:orgId/event/:eventId",
    {
      schema: withTags(["RSVP"], {
        summary: "Submit an RSVP for an event.",
        params: z.object({
          eventId: z.string().min(1).meta({
            description: "The previously-created event ID in the events API.",
          }),
        }),
        headers: z.object({
          "x-uiuc-token": z.jwt().min(1).meta({
            description:
              "An access token for the user in the UIUC Entra ID tenant.",
          }),
        }),
      }),
    },
    async (request, reply) => {
      const accessToken = request.headers["x-uiuc-token"];
      const verifiedData = await verifyUiucAccessToken({
        accessToken,
        logger: request.log,
      });
      const { userPrincipalName: upn, givenName, surname } = verifiedData;
      const netId = upn.replace("@illinois.edu", "");
      if (netId.includes("@")) {
        request.log.error(
          `Found UPN ${upn} which cannot be turned into NetID via simple replacement.`,
        );
        throw new ValidationError({
          message: "ID token could not be parsed.",
        });
      }
      const isPaidMember = await checkPaidMembership({
        netId,
        dynamoClient: fastify.dynamoClient,
        redisClient: fastify.redisClient,
        logger: request.log,
      });
      const entry = {
        partitionKey: `${request.params.eventId}#${upn}`,
        eventId: request.params.eventId,
        userId: upn,
        isPaidMember,
        createdAt: "",
      };
    },
  );
};

export default rsvpRoutes;
