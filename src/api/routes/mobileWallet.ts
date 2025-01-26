import { FastifyPluginAsync } from "fastify";
import { issueAppleWalletMembershipCard } from "../functions/mobileWallet.js";
import { UnauthenticatedError } from "../../common/errors/index.js";

const mobileWalletRoute: FastifyPluginAsync = async (fastify, _options) => {
  fastify.get(
    "/apple",
    {
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, []);
      },
    },
    async (request, reply) => {
      if (!request.username || !request.tokenPayload) {
        throw new UnauthenticatedError({ message: "Could not find user." });
      }
      const item = await issueAppleWalletMembershipCard(
        fastify,
        request,
        request.username,
        request.tokenPayload.name,
      );
      reply.type("application/vnd.apple.pkpass");
      reply.send(item);
    },
  );
};

export default mobileWalletRoute;
