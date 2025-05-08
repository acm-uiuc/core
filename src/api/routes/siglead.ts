import fastify, { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AppRoles } from "../../common/roles.js";
import {
  BaseError,
  DatabaseDeleteError,
  DatabaseFetchError,
  DatabaseInsertError,
  NotFoundError,
  UnauthenticatedError,
  UnauthorizedError,
  ValidationError,
} from "../../common/errors/index.js";
import { NoDataRequest } from "../types.js";
import {
  DynamoDBClient,
  QueryCommand,
  DeleteItemCommand,
  ScanCommand,
  TransactWriteItemsCommand,
  AttributeValue,
  TransactWriteItem,
  GetItemCommand,
  TransactionCanceledException,
  InternalServerError,
} from "@aws-sdk/client-dynamodb";
import { CloudFrontKeyValueStoreClient } from "@aws-sdk/client-cloudfront-keyvaluestore";
import {
  genericConfig,
  EVENT_CACHED_DURATION,
  LinkryGroupUUIDToGroupNameMap,
  roleArns,
} from "../../common/config.js";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import rateLimiter from "api/plugins/rateLimiter.js";
import {
  deleteKey,
  getLinkryKvArn,
  setKey,
} from "api/functions/cloudfrontKvStore.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  SigDetailRecord,
  SigleadGetRequest,
  SigMemberCount,
  SigMemberRecord,
} from "common/types/siglead.js";
import {
  addMemberRecordToSig,
  fetchMemberRecords,
  fetchSigCounts,
  fetchSigDetail,
} from "api/functions/siglead.js";
import { intersection } from "api/plugins/auth.js";
import {
  FastifyZodOpenApiSchema,
  FastifyZodOpenApiTypeProvider,
} from "fastify-zod-openapi";
import { withRoles, withTags } from "api/components/index.js";
import { AnyARecord } from "dns";
import { getEntraIdToken } from "api/functions/entraId.js";
import { getRoleCredentials } from "api/functions/sts.js";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { logger } from "api/sqs/logger.js";
import fastifyStatic from "@fastify/static";

const postAddSigMemberSchema = z.object({
  sigGroupId: z.string().min(1),
  email: z.string().min(1), // TODO: verify email and @illinois.edu
  designation: z.string().min(1).max(1),
  memberName: z.string().min(1),
});

const sigleadRoutes: FastifyPluginAsync = async (fastify, _options) => {
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
    fastify.get<SigleadGetRequest>(
      "/sigcount",
      {
        onRequest: async (request, reply) => {
          /*await fastify.authorize(request, reply, [
              AppRoles.LINKS_MANAGER,
              AppRoles.LINKS_ADMIN,
            ]);*/
        },
      },
      async (request, reply) => {
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
      },
    );
    fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
      "/addMember/:sigid",
      {
        schema: withRoles(
          [AppRoles.SIGLEAD_MANAGER],
          withTags(["Sigid"], {
            // response: {
            //   201: z.object({
            //     id: z.string(),
            //     resource: z.string(),
            //   }),
            // },
            body: postAddSigMemberSchema,
            summary: "Add a member to a sig.",
          }),
        ) satisfies FastifyZodOpenApiSchema,
        onRequest: fastify.authorizeFromSchema,
      },
      async (request, reply) => {
        const { sigGroupId, email, designation, memberName } = request.body;
        const tableName = genericConfig.SigleadDynamoSigMemberTableName;

        // First try-catch: See if the member already exists
        let sigMembers: SigMemberRecord[];
        try {
          sigMembers = await fetchMemberRecords(
            sigGroupId,
            tableName,
            fastify.dynamoClient,
          );
        } catch (error) {
          request.log.error(
            `Could not verify the member does not already exist in the sig: ${error instanceof Error ? error.toString() : "Unknown error"}`,
          );
          throw new DatabaseFetchError({
            message: "Failed to fetch sig member records from Dynamo table.",
          });
        }

        for (const sigMember of sigMembers) {
          if (sigMember.email === email) {
            throw new ValidationError({
              message: "Member already exists in sig.",
            });
          }
        }

        const newMemberRecord: SigMemberRecord = request.body;
        // Second try-catch: Try to add the member to Dynamo and AAD, rolling back if failure
        try {
          //FIXME: this is failing due to auth
          const entraIdToken = await getEntraIdToken(
            await getAuthorizedClients(),
            fastify.environmentConfig.AadValidClientId,
          );

          await addMemberRecordToSig(
            newMemberRecord,
            tableName,
            fastify.dynamoClient,
            entraIdToken,
          );
        } catch (error: any) {
          request.log.error(
            `Error while adding member to sig: ${error instanceof Error ? error.toString() : "Unknown error"}`,
          );
          throw error;
        }

        // Send the response
        reply.code(200).send({
          message: "Added member to sig.",
        });
      },
    );
  };

  fastify.register(limitedRoutes);
};

export default sigleadRoutes;
