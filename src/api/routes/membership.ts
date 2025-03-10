import {
  checkPaidMembershipFromEntra,
  checkPaidMembershipFromTable,
  setPaidMembershipInTable,
} from "api/functions/membership.js";
import { validateNetId } from "api/functions/validation.js";
import { FastifyPluginAsync } from "fastify";
import { ValidationError } from "common/errors/index.js";
import { getEntraIdToken } from "api/functions/entraId.js";
import { genericConfig, roleArns } from "common/config.js";
import { getRoleCredentials } from "api/functions/sts.js";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

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
