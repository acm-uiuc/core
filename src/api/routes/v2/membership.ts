import {
  checkPaidMembershipFromTable,
  checkPaidMembershipFromRedis,
} from "api/functions/membership.js";
import { FastifyPluginAsync } from "fastify";
import { ValidationError } from "common/errors/index.js";
import rateLimiter from "api/plugins/rateLimiter.js";
import { createCheckoutSession } from "api/functions/stripe.js";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import * as z from "zod/v4";
import { notAuthenticatedError, withTags } from "api/components/index.js";
import { verifyUiucAccessToken, getHashedUserUin } from "api/functions/uin.js";

function splitOnce(s: string, on: string) {
  const [first, ...rest] = s.split(on);
  return [first, rest.length > 0 ? rest.join(on) : null];
}
function trim(s: string) {
  return (s || "").replace(/^\s+|\s+$/g, "");
}

const membershipV2Plugin: FastifyPluginAsync = async (fastify, _options) => {
  const limitedRoutes: FastifyPluginAsync = async (fastify) => {
    await fastify.register(rateLimiter, {
      limit: 15,
      duration: 30,
      rateLimitIdentifier: "membershipV2",
    });
    fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
      "/checkout",
      {
        schema: withTags(["Membership"], {
          headers: z.object({
            "x-uiuc-token": z.jwt().min(1).meta({
              description:
                "An access token for the user in the UIUC Entra ID tenant.",
            }),
          }),
          summary:
            "Create a checkout session to purchase an ACM @ UIUC membership.",
          response: {
            200: {
              description: "Stripe checkout link.",
              content: {
                "text/plain": {
                  schema: z.url().meta({
                    example:
                      "https://buy.stripe.com/test_14A00j9Hq9tj9ZfchM3AY0s",
                  }),
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
        let isPaidMember = await checkPaidMembershipFromRedis(
          netId,
          fastify.redisClient,
          request.log,
        );
        if (isPaidMember === null) {
          isPaidMember = await checkPaidMembershipFromTable(
            netId,
            fastify.dynamoClient,
          );
        }
        if (isPaidMember) {
          throw new ValidationError({
            message: `${upn} is already a paid member.`,
          });
        }

        return reply.status(200).send(
          await createCheckoutSession({
            successUrl: "https://acm.illinois.edu/paid",
            returnUrl: "https://acm.illinois.edu/membership",
            customerEmail: upn,
            stripeApiKey: fastify.secretConfig.stripe_secret_key as string,
            items: [
              {
                price: fastify.environmentConfig.PaidMemberPriceId,
                quantity: 1,
              },
            ],
            customFields: [
              {
                key: "firstName",
                label: {
                  type: "custom",
                  custom: "Member First Name",
                },
                type: "text",
                text: {
                  default_value: givenName,
                },
              },
              {
                key: "lastName",
                label: {
                  type: "custom",
                  custom: "Member Last Name",
                },
                type: "text",
                text: {
                  default_value: surname,
                },
              },
            ],
            initiator: "purchase-membership",
            allowPromotionCodes: true,
          }),
        );
      },
    );
  };
  fastify.register(limitedRoutes);
};

export default membershipV2Plugin;
