import { FastifyBaseLogger, FastifyPluginAsync } from "fastify";
import {
  UnauthenticatedError,
  ValidationError,
} from "../../../common/errors/index.js";
import * as z from "zod/v4";
import {
  checkPaidMembershipFromRedis,
  checkPaidMembershipFromTable,
} from "../../functions/membership.js";
import rateLimiter from "api/plugins/rateLimiter.js";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import { notAuthenticatedError, withTags } from "api/components/index.js";
import jwt, { Algorithm } from "jsonwebtoken";
import { getJwksKey } from "api/plugins/auth.js";
import { issueAppleWalletMembershipCard } from "api/functions/mobileWallet.js";
import { Redis } from "api/types.js";
import { Readable } from "stream";

const UIUC_TENANT_ID = "44467e6f-462c-4ea2-823f-7800de5434e3";
const COULD_NOT_PARSE_MESSAGE = "ID token could not be parsed.";

export const verifyUiucIdToken = async ({
  idToken,
  redisClient,
  logger,
}: {
  idToken: string | string[] | undefined;
  redisClient: Redis;
  logger: FastifyBaseLogger;
}) => {
  if (!idToken) {
    throw new UnauthenticatedError({
      message: "ID token not found.",
    });
  }
  if (Array.isArray(idToken)) {
    throw new ValidationError({
      message: "Multiple tokens cannot be specified!",
    });
  }
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded) {
    throw new UnauthenticatedError({
      message: COULD_NOT_PARSE_MESSAGE,
    });
  }
  const header = decoded?.header;
  if (!header.kid) {
    throw new UnauthenticatedError({
      message: COULD_NOT_PARSE_MESSAGE,
    });
  }
  const signingKey = await getJwksKey({
    redisClient,
    kid: header.kid,
    logger,
  });
  const verifyOptions: jwt.VerifyOptions = {
    algorithms: ["RS256" as Algorithm],
    issuer: `https://login.microsoftonline.com/${UIUC_TENANT_ID}/v2.0`,
  };
  let verifiedData;
  try {
    verifiedData = jwt.verify(idToken, signingKey, verifyOptions) as {
      preferred_username?: string;
      email?: string;
      name?: string;
    };
  } catch (e) {
    if (e instanceof Error && e.name === "TokenExpiredError") {
      throw new UnauthenticatedError({
        message: "Access token has expired.",
      });
    }
    if (e instanceof Error && e.name === "JsonWebTokenError") {
      logger.error(e);
      throw new UnauthenticatedError({
        message: COULD_NOT_PARSE_MESSAGE,
      });
    }
    throw e;
  }
  const { preferred_username: upn, email, name } = verifiedData;
  if (!upn || !email || !name) {
    throw new UnauthenticatedError({
      message: COULD_NOT_PARSE_MESSAGE,
    });
  }
  return verifiedData as {
    preferred_username: string;
    email: string;
    name: string;
  };
};

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
          "x-uiuc-id-token": z.jwt().min(1).meta({
            description:
              "An ID token for the user in the UIUC Entra ID tenant.",
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
      const idToken = request.headers["x-uiuc-id-token"];
      const verifiedData = await verifyUiucIdToken({
        idToken,
        redisClient: fastify.redisClient,
        logger: request.log,
      });
      const { preferred_username: upn, name } = verifiedData;
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
        name,
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
