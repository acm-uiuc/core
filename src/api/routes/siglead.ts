import { FastifyPluginAsync } from "fastify";
import { DatabaseFetchError } from "../../common/errors/index.js";

import { genericConfig } from "../../common/config.js";

import {
  SigDetailRecord,
  SigleadGetRequest,
  SigMemberCount,
  SigMemberRecord,
  SigMemberUpdateRecord,
} from "common/types/siglead.js";
import {
  addMemberToSigDynamo,
  fetchMemberRecords,
  fetchSigCounts,
  fetchSigDetail,
} from "api/functions/siglead.js";
import { intersection } from "api/plugins/auth.js";
import { request } from "http";

const sigleadRoutes: FastifyPluginAsync = async (fastify, _options) => {
  const limitedRoutes: FastifyPluginAsync = async (fastify) => {
    /*fastify.register(rateLimiter, {
      limit: 30,
      duration: 60,
      rateLimitIdentifier: "linkry",
    });*/

    fastify.get<SigleadGetRequest>(
      "/sigmembers/:sigid",
      {
        onRequest: async (request, reply) => {
          /*await fastify.authorize(request, reply, [
            AppRoles.LINKS_MANAGER,
            AppRoles.LINKS_ADMIN,
          ]);*/
        },
      },
      async (request, reply) => {
        const { sigid } = request.params;
        const tableName = genericConfig.SigleadDynamoSigMemberTableName;

        // First try-catch: Fetch owner records
        let memberRecords: SigMemberRecord[];
        try {
          memberRecords = await fetchMemberRecords(
            sigid,
            tableName,
            fastify.dynamoClient,
          );
        } catch (error) {
          request.log.error(
            `Failed to fetch member records: ${error instanceof Error ? error.toString() : "Unknown error"}`,
          );
          throw new DatabaseFetchError({
            message: "Failed to fetch member records from Dynamo table.",
          });
        }

        // Send the response
        reply.code(200).send(memberRecords);
      },
    );

    fastify.get<SigleadGetRequest>(
      "/sigdetail/:sigid",
      {
        onRequest: async (request, reply) => {
          /*await fastify.authorize(request, reply, [
              AppRoles.LINKS_MANAGER,
              AppRoles.LINKS_ADMIN,
            ]);*/
        },
      },
      async (request, reply) => {
        const { sigid } = request.params;
        const tableName = genericConfig.SigleadDynamoSigDetailTableName;

        // First try-catch: Fetch owner records
        let sigDetail: SigDetailRecord;
        try {
          sigDetail = await fetchSigDetail(
            sigid,
            tableName,
            fastify.dynamoClient,
          );
        } catch (error) {
          request.log.error(
            `Failed to fetch sig detail record: ${error instanceof Error ? error.toString() : "Unknown error"}`,
          );
          throw new DatabaseFetchError({
            message: "Failed to fetch sig detail record from Dynamo table.",
          });
        }

        // Send the response
        reply.code(200).send(sigDetail);
      },
    );

    // fetch sig count
    fastify.get<SigleadGetRequest>("/sigcount", async (request, reply) => {
      // First try-catch: Fetch owner records
      let sigMemCounts: SigMemberCount[];
      try {
        sigMemCounts = await fetchSigCounts(
          genericConfig.SigleadDynamoSigMemberTableName,
          fastify.dynamoClient,
        );
      } catch (error) {
        request.log.error(
          `Failed to fetch sig member counts record: ${error instanceof Error ? error.toString() : "Unknown error"}`,
        );
        throw new DatabaseFetchError({
          message:
            "Failed to fetch sig member counts record from Dynamo table.",
        });
      }

      // Send the response
      reply.code(200).send(sigMemCounts);
    });

    // add member
    fastify.post<{ Body: SigMemberUpdateRecord }>(
      "/addMember",
      async (request, reply) => {
        try {
          await addMemberToSigDynamo(
            genericConfig.SigleadDynamoSigMemberTableName,
            request.body,
            fastify.dynamoClient,
          );
        } catch (error) {
          request.log.error(
            `Failed to add member: ${error instanceof Error ? error.toString() : "Unknown error"}`,
          );
          throw new DatabaseFetchError({
            message: "Failed to add sig member record to Dynamo table.",
          });
        }
        reply.code(200);
      },
    );
  };

  fastify.register(limitedRoutes);
};

export default sigleadRoutes;
