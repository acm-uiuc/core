import {
  checkPaidMembershipFromEntra,
  checkPaidMembershipFromTable,
  setPaidMembershipInTable,
} from "api/functions/membership.js";
import { validateNetId } from "api/functions/validation.js";
import { FastifyPluginAsync } from "fastify";
import { ValidationError } from "common/errors/index.js";
import { getEntraIdToken } from "api/functions/entraId.js";

const membershipPlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.get<{
    Body: undefined;
    Querystring: { netId: string };
  }>(
    "/:netId",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            netId: {
              type: "string",
            },
          },
        },
      },
    },
    async (request, reply) => {
      const netId = (request.params as Record<string, string>).netId;
      if (!validateNetId(netId)) {
        throw new ValidationError({
          message: `${netId} is not a valid Illinois NetID!`,
        });
      }
      const isDynamoMember = await checkPaidMembershipFromTable(
        netId,
        fastify.dynamoClient,
      );
      // check Dynamo cache first
      if (isDynamoMember) {
        return reply
          .header("X-ACM-Data-Source", "dynamo")
          .send({ netId, isPaidMember: true });
      }
      // check AAD
      const entraIdToken = await getEntraIdToken(
        {
          smClient: fastify.secretsManagerClient,
          dynamoClient: fastify.dynamoClient,
        },
        fastify.environmentConfig.AadValidClientId,
      );
      const paidMemberGroup = fastify.environmentConfig.PaidMemberGroupId;
      const isAadMember = await checkPaidMembershipFromEntra(
        netId,
        entraIdToken,
        paidMemberGroup,
      );
      if (isAadMember) {
        reply
          .header("X-ACM-Data-Source", "aad")
          .send({ netId, isPaidMember: true });
        await setPaidMembershipInTable(netId, fastify.dynamoClient);
        return;
      }
      return reply
        .header("X-ACM-Data-Source", "aad")
        .send({ netId, isPaidMember: false });
    },
  );
};

export default membershipPlugin;
