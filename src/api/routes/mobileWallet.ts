import { FastifyPluginAsync } from "fastify";
import { issueAppleWalletMembershipCard } from "../functions/mobileWallet.js";
import {
  UnauthenticatedError,
  UnauthorizedError,
  ValidationError,
} from "../../common/errors/index.js";
import { generateMembershipEmailCommand } from "api/functions/ses.js";
import { z } from "zod";
import { getEntraIdToken, getUserProfile } from "api/functions/entraId.js";

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

      const membershipApiPayload = (await (
        await fetch(
          `${fastify.environmentConfig.MembershipApiEndpoint}?netId=${request.query.email.replace("@illinois.edu", "")}`,
        )
      ).json()) as { netId: string; isPaidMember: boolean };
      try {
        if (!membershipApiPayload["isPaidMember"]) {
          throw new UnauthorizedError({
            message: "User is not a paid member.",
          });
        }
      } catch (e: any) {
        request.log.error(
          `Failed to get response from membership API: ${e.toString()}`,
        );
        throw e;
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
      await fastify.sesClient.send(emailCommand);
      reply.status(202).send({ message: "OK" });
    },
  );
};

export default mobileWalletRoute;
