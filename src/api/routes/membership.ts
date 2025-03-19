import {
  checkPaidMembershipFromEntra,
  checkPaidMembershipFromTable,
  setPaidMembershipInTable,
} from "api/functions/membership.js";
import { validateNetId } from "api/functions/validation.js";
import { FastifyPluginAsync } from "fastify";
import { InternalServerError, ValidationError } from "common/errors/index.js";
import { getEntraIdToken } from "api/functions/entraId.js";
import { genericConfig, roleArns } from "common/config.js";
import { getRoleCredentials } from "api/functions/sts.js";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import rateLimiter from "api/plugins/rateLimiter.js";
import { createCheckoutSession } from "api/functions/stripe.js";
import { getSecretValue } from "api/plugins/auth.js";

const NONMEMBER_CACHE_SECONDS = 1800; // 30 minutes
const MEMBER_CACHE_SECONDS = 43200; // 12 hours

const membershipPlugin: FastifyPluginAsync = async (fastify, _options) => {
  const getAuthorizedClients = async () => {
    if (roleArns.Entra) {
      fastify.log.info(
        `Attempting to assume Entra role ${roleArns.Entra} to get the Entra token...`,
      );
      const credentials = await getRoleCredentials(roleArns.Entra);
      const clients = {
        smClient: new SecretsManagerClient({
          region: genericConfig.AwsRegion,
          credentials,
        }),
        dynamoClient: new DynamoDBClient({
          region: genericConfig.AwsRegion,
          credentials,
        }),
      };
      fastify.log.info(
        `Assumed Entra role ${roleArns.Entra} to get the Entra token.`,
      );
      return clients;
    } else {
      fastify.log.debug(
        "Did not assume Entra role as no env variable was present",
      );
      return {
        smClient: fastify.secretsManagerClient,
        dynamoClient: fastify.dynamoClient,
      };
    }
  };
  const limitedRoutes: FastifyPluginAsync = async (fastify) => {
    await fastify.register(rateLimiter, {
      limit: 20,
      duration: 30,
      rateLimitIdentifier: "membership",
    });
    fastify.get<{
      Body: undefined;
      Querystring: { netId: string };
    }>("/checkoutSession/:netId", async (request, reply) => {
      const netId = (request.params as Record<string, string>).netId;
      if (!validateNetId(netId)) {
        throw new ValidationError({
          message: `${netId} is not a valid Illinois NetID!`,
        });
      }
      if (fastify.nodeCache.get(`isMember_${netId}`) === true) {
        throw new ValidationError({
          message: `${netId} is already a paid member!`,
        });
      }
      const isDynamoMember = await checkPaidMembershipFromTable(
        netId,
        fastify.dynamoClient,
      );
      if (isDynamoMember) {
        fastify.nodeCache.set(`isMember_${netId}`, true, MEMBER_CACHE_SECONDS);
        throw new ValidationError({
          message: `${netId} is already a paid member!`,
        });
      }
      const entraIdToken = await getEntraIdToken(
        await getAuthorizedClients(),
        fastify.environmentConfig.AadValidClientId,
      );
      const paidMemberGroup = fastify.environmentConfig.PaidMemberGroupId;
      const isAadMember = await checkPaidMembershipFromEntra(
        netId,
        entraIdToken,
        paidMemberGroup,
      );
      if (isAadMember) {
        fastify.nodeCache.set(`isMember_${netId}`, true, MEMBER_CACHE_SECONDS);
        reply
          .header("X-ACM-Data-Source", "aad")
          .send({ netId, isPaidMember: true });
        await setPaidMembershipInTable(netId, fastify.dynamoClient);
        throw new ValidationError({
          message: `${netId} is already a paid member!`,
        });
      }
      fastify.nodeCache.set(
        `isMember_${netId}`,
        false,
        NONMEMBER_CACHE_SECONDS,
      );
      const secretApiConfig =
        (await getSecretValue(
          fastify.secretsManagerClient,
          genericConfig.ConfigSecretName,
        )) || {};
      if (!secretApiConfig) {
        throw new InternalServerError({
          message: "Could not connect to Stripe.",
        });
      }
      return reply.status(200).send(
        await createCheckoutSession({
          successUrl: "https://acm.illinois.edu/paid",
          returnUrl: "https://acm.illinois.edu/membership",
          stripeApiKey: secretApiConfig.stripe_secret_key as string,
          items: [
            { price: fastify.environmentConfig.PaidMemberPriceId, quantity: 1 },
          ],
        }),
      );
    });
    fastify.get<{
      Body: undefined;
      Querystring: { netId: string };
    }>("/:netId", async (request, reply) => {
      const netId = (request.params as Record<string, string>).netId;
      if (!validateNetId(netId)) {
        throw new ValidationError({
          message: `${netId} is not a valid Illinois NetID!`,
        });
      }
      if (fastify.nodeCache.get(`isMember_${netId}`) !== undefined) {
        return reply.header("X-ACM-Data-Source", "cache").send({
          netId,
          isPaidMember: fastify.nodeCache.get(`isMember_${netId}`),
        });
      }
      const isDynamoMember = await checkPaidMembershipFromTable(
        netId,
        fastify.dynamoClient,
      );
      if (isDynamoMember) {
        fastify.nodeCache.set(`isMember_${netId}`, true, MEMBER_CACHE_SECONDS);
        return reply
          .header("X-ACM-Data-Source", "dynamo")
          .send({ netId, isPaidMember: true });
      }
      const entraIdToken = await getEntraIdToken(
        await getAuthorizedClients(),
        fastify.environmentConfig.AadValidClientId,
      );
      const paidMemberGroup = fastify.environmentConfig.PaidMemberGroupId;
      const isAadMember = await checkPaidMembershipFromEntra(
        netId,
        entraIdToken,
        paidMemberGroup,
      );
      if (isAadMember) {
        fastify.nodeCache.set(`isMember_${netId}`, true, MEMBER_CACHE_SECONDS);
        reply
          .header("X-ACM-Data-Source", "aad")
          .send({ netId, isPaidMember: true });
        await setPaidMembershipInTable(netId, fastify.dynamoClient);
        return;
      }
      fastify.nodeCache.set(
        `isMember_${netId}`,
        false,
        NONMEMBER_CACHE_SECONDS,
      );
      return reply
        .header("X-ACM-Data-Source", "aad")
        .send({ netId, isPaidMember: false });
    });
  };
  fastify.register(limitedRoutes);
};

export default membershipPlugin;
