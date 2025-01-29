import { FastifyPluginAsync } from "fastify";
import { issueAppleWalletMembershipCard } from "../functions/mobileWallet.js";
import {
  EntraFetchError,
  UnauthenticatedError,
  UnauthorizedError,
  ValidationError,
} from "../../common/errors/index.js";
import { generateMembershipEmailCommand } from "../functions/ses.js";
import { z } from "zod";
import { getEntraIdToken, getUserProfile } from "../functions/entraId.js";
import { checkPaidMembership } from "../functions/membership.js";

const mobileWalletRoute: FastifyPluginAsync = async (fastify, _options) => {
  fastify.get<{ Querystring: { email: string } }>(
    "/membership",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            email: { type: "string", format: "email" },
          },
          required: ["email"],
        },
      },
    },
    async (request, reply) => {
      if (!request.query.email) {
        throw new UnauthenticatedError({ message: "Could not find user." });
      }
      try {
        await z
          .string()
          .email()
          .refine(
            (email) => email.endsWith("@illinois.edu"),
            "Email must be on the illinois.edu domain.",
          )
          .parseAsync(request.query.email);
      } catch {
        throw new ValidationError({
          message: "Email query parameter is not a valid email",
        });
      }
      const isPaidMember = await checkPaidMembership(
        fastify.environmentConfig.MembershipApiEndpoint,
        request.log,
        request.query.email.replace("@illinois.edu", ""),
      );
      if (!isPaidMember) {
        throw new UnauthenticatedError({
          message: `${request.query.email} is not a paid member.`,
        });
      }
      const entraIdToken = await getEntraIdToken(
        fastify,
        fastify.environmentConfig.AadValidClientId,
      );

      const userProfile = await getUserProfile(
        entraIdToken,
        request.query.email,
      );

      const item = await issueAppleWalletMembershipCard(
        fastify,
        request,
        request.query.email,
        userProfile.displayName,
      );
      const emailCommand = generateMembershipEmailCommand(
        request.query.email,
        `membership@${fastify.environmentConfig.EmailDomain}`,
        item,
      );
      if (
        fastify.runEnvironment === "dev" &&
        request.query.email === "testinguser@illinois.edu"
      ) {
        return reply
          .status(202)
          .send({ message: "OK (skipped sending email)" });
      }
      await fastify.sesClient.send(emailCommand);
      reply.status(202).send({ message: "OK" });
    },
  );
};

export default mobileWalletRoute;
