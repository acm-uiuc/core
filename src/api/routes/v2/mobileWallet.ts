import { FastifyPluginAsync } from "fastify";
import { UnauthenticatedError } from "../../../common/errors/index.js";
import * as z from "zod/v4";
import rateLimiter from "api/plugins/rateLimiter.js";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import { notAuthenticatedError, withTags } from "api/components/index.js";
import { issueAppleWalletMembershipCard } from "api/functions/mobileWallet.js";
import { Readable } from "stream";
import { verifyUiucAccessToken } from "api/functions/uin.js";
import { checkPaidMembership } from "api/functions/membership.js";

const mobileWalletV2Route: FastifyPluginAsync = async (fastify, _options) => {
  fastify.register(rateLimiter, {
    limit: 15,
    duration: 30,
    rateLimitIdentifier: "mobileWalletV2",
  });
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/membership",
    {
      schema: withTags(["Mobile Wallet"], {
        summary: "Retrieve mobile wallet pass for ACM member.",
        headers: z.object({
          "x-uiuc-token": z.jwt().min(1).meta({
            description:
              "An access token for the user in the UIUC Entra ID tenant.",
          }),
        }),
        response: {
          200: {
            description: "The mobile wallet pass has been generated.",
            content: {
              "application/vnd.apple.pkpass": {
                schema: z.file(),
                description:
                  "A pkpass file which contains the user's ACM @ UIUC membership pass.",
              },
            },
          },
          403: notAuthenticatedError,
        },
      }),
    },
    async (request, reply) => {
      const accessToken = request.headers["x-uiuc-token"];
      const verifiedData = await verifyUiucAccessToken({
        accessToken,
        logger: request.log,
      });
      const {
        userPrincipalName: upn,
        givenName,
        surname,
        netId,
      } = verifiedData;
      const isPaidMember = await checkPaidMembership({
        netId,
        dynamoClient: fastify.dynamoClient,
        redisClient: fastify.redisClient,
        logger: request.log,
      });

      if (!isPaidMember) {
        throw new UnauthenticatedError({
          message: `${upn} is not a paid member.`,
        });
      }

      const pkpass = await issueAppleWalletMembershipCard(
        { smClient: fastify.secretsManagerClient },
        fastify.environmentConfig,
        fastify.runEnvironment,
        upn,
        upn,
        request.log,
        `${givenName} ${surname}`,
      );
      const myStream = new Readable({
        read() {
          this.push(pkpass);
          this.push(null);
        },
      });

      await reply.type("application/vnd.apple.pkpass").send(myStream);
    },
  );
};

export default mobileWalletV2Route;
