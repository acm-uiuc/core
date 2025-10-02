import { FastifyError, FastifyPluginAsync } from "fastify";
import {
  ACMOrganization,
  AllOrganizationList,
  OrganizationShortIdentifierMapping,
} from "@acm-uiuc/js-shared";
import rateLimiter from "api/plugins/rateLimiter.js";
import { withRoles, withTags } from "api/components/index.js";
import { z } from "zod/v4";
import {
  getOrganizationInfoResponse,
  ORG_DATA_CACHED_DURATION,
  patchOrganizationLeadsBody,
  setOrganizationMetaBody,
} from "common/types/organizations.js";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import {
  BaseError,
  DatabaseFetchError,
  DatabaseInsertError,
  InternalServerError,
  ValidationError,
} from "common/errors/index.js";
import {
  addLead,
  getLeadsM365DynamicQuery,
  getOrgInfo,
  removeLead,
  SQSMessage,
} from "api/functions/organizations.js";
import { AppRoles } from "common/roles.js";
import {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItem,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import {
  execCouncilGroupId,
  execCouncilTestingGroupId,
  genericConfig,
  notificationRecipients,
  roleArns,
} from "common/config.js";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { buildAuditLogTransactPut } from "api/functions/auditLog.js";
import { Modules } from "common/modules.js";
import { authorizeByOrgRoleOrSchema } from "api/functions/authorization.js";
import { checkPaidMembership } from "api/functions/membership.js";
import {
  createM365Group,
  getEntraIdToken,
  setGroupMembershipRule,
} from "api/functions/entraId.js";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { getRoleCredentials } from "api/functions/sts.js";
import { SQSClient } from "@aws-sdk/client-sqs";
import { sendSqsMessagesInBatches } from "api/functions/sqs.js";
import { retryDynamoTransactionWithBackoff } from "api/utils.js";
import {
  assignIdpGroupsToTeam,
  createGithubTeam,
} from "api/functions/github.js";
import { requestFormReset } from "react-dom";

export const CLIENT_HTTP_CACHE_POLICY = `public, max-age=${ORG_DATA_CACHED_DURATION}, stale-while-revalidate=${Math.floor(ORG_DATA_CACHED_DURATION * 1.1)}, stale-if-error=3600`;

const organizationsPlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.register(rateLimiter, {
    limit: 60,
    duration: 60,
    rateLimitIdentifier: "organizations",
  });

  fastify.addHook("onSend", async (request, reply, payload) => {
    if (request.method === "GET") {
      reply.header("Cache-Control", CLIENT_HTTP_CACHE_POLICY);
    }
    return payload;
  });

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
        redisClient: fastify.redisClient,
      };
      fastify.log.info(
        `Assumed Entra role ${roleArns.Entra} to get the Entra token.`,
      );
      return clients;
    }
    fastify.log.debug(
      "Did not assume Entra role as no env variable was present",
    );
    return {
      smClient: fastify.secretsManagerClient,
      dynamoClient: fastify.dynamoClient,
      redisClient: fastify.redisClient,
    };
  };

  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "",
    {
      schema: withTags(["Organizations"], {
        summary: "Get info for all of ACM @ UIUC's sub-organizations.",
        response: {
          200: {
            description: "List of ACM @ UIUC sub-organizations and info.",
            content: {
              "application/json": {
                schema: z.array(getOrganizationInfoResponse),
              },
            },
          },
        },
      }),
    },
    async (request, reply) => {
      let isAuthenticated = false;
      if (request.headers.authorization) {
        try {
          await fastify.authorize(
            request,
            reply,
            [AppRoles.ALL_ORG_MANAGER],
            false,
          );
          isAuthenticated = true;
        } catch (e) {
          isAuthenticated = false;
        }
      }
      const promises = AllOrganizationList.map((x) =>
        getOrgInfo({
          id: x,
          dynamoClient: fastify.dynamoClient,
          logger: request.log,
        }),
      );
      try {
        const data = await Promise.allSettled(promises);
        let successOnly = data
          .filter((x) => x.status === "fulfilled")
          .map((x) => x.value);
        const successIds = successOnly.map((x) => x.id);
        if (!isAuthenticated) {
          successOnly = successOnly.map((x) => ({
            ...x,
            leadsEntraGroupId: undefined,
          }));
        }
        const unknownIds = AllOrganizationList.filter(
          (x) => !successIds.includes(x),
        ).map((x) => ({ id: x }));
        return reply.send([...successOnly, ...unknownIds]);
      } catch (e) {
        if (e instanceof BaseError) {
          throw e;
        }
        request.log.error(e);
        throw new DatabaseFetchError({
          message: "Failed to get org information.",
        });
      }
    },
  );

  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/:orgId",
    {
      schema: withTags(["Organizations"], {
        summary:
          "Get information about a specific ACM @ UIUC sub-organization.",
        params: z.object({
          orgId: z
            .enum(AllOrganizationList)
            .meta({ description: "ACM @ UIUC organization to query." }),
        }),
        response: {
          200: {
            description: "ACM @ UIUC sub-organization info.",
            content: {
              "application/json": {
                schema: getOrganizationInfoResponse,
              },
            },
          },
        },
      }),
    },
    async (request, reply) => {
      let isAuthenticated = false;
      if (request.headers.authorization) {
        try {
          await fastify.authorize(
            request,
            reply,
            [AppRoles.ALL_ORG_MANAGER],
            false,
          );
          isAuthenticated = true;
        } catch (e) {
          isAuthenticated = false;
        }
      }
      const response = await getOrgInfo({
        id: request.params.orgId,
        dynamoClient: fastify.dynamoClient,
        logger: request.log,
      });
      if (!isAuthenticated) {
        return reply.send({ ...response, leadsEntraGroupId: undefined });
      }
      return reply.send(response);
    },
  );

  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/:orgId/meta",
    {
      schema: withRoles(
        [AppRoles.ALL_ORG_MANAGER],
        withTags(["Organizations"], {
          summary: "Set metadata for an ACM @ UIUC sub-organization.",
          params: z.object({
            orgId: z
              .enum(AllOrganizationList)
              .meta({ description: "ACM @ UIUC organization to modify." }),
          }),
          body: setOrganizationMetaBody,
          response: {
            201: {
              description: "The information was saved.",
              content: {
                "application/json": {
                  schema: z.null(),
                },
              },
            },
          },
        }),
        {
          disableApiKeyAuth: false,
          notes:
            "Authenticated leads of the organization without the appropriate role may also perform this action.",
        },
      ),
      onRequest: async (request, reply) => {
        await authorizeByOrgRoleOrSchema(fastify, request, reply, {
          validRoles: [{ org: request.params.orgId, role: "LEAD" }],
        });
      },
    },
    async (request, reply) => {
      const timestamp = new Date().toISOString();
      const logStatement = buildAuditLogTransactPut({
        entry: {
          module: Modules.ORG_INFO,
          message: "Updated organization metadata.",
          actor: request.username!,
          target: request.params.orgId,
        },
      });

      const metadataOperation = async () => {
        const commandTransaction = new TransactWriteItemsCommand({
          TransactItems: [
            ...(logStatement ? [logStatement] : []),
            {
              Put: {
                TableName: genericConfig.SigInfoTableName,
                Item: marshall(
                  {
                    ...request.body,
                    primaryKey: `DEFINE#${request.params.orgId}`,
                    entryId: "0",
                    updatedAt: timestamp,
                  },
                  { removeUndefinedValues: true },
                ),
              },
            },
          ],
        });
        return await fastify.dynamoClient.send(commandTransaction);
      };

      try {
        await retryDynamoTransactionWithBackoff(
          metadataOperation,
          request.log,
          `Update metadata for ${request.params.orgId}`,
        );
      } catch (e) {
        if (e instanceof BaseError) {
          throw e;
        }
        request.log.error(e);
        throw new DatabaseInsertError({
          message: "Failed to set org information.",
        });
      }
      return reply.status(201).send();
    },
  );

  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().patch(
    "/:orgId/leads",
    {
      schema: withRoles(
        [AppRoles.ALL_ORG_MANAGER],
        withTags(["Organizations"], {
          summary: "Set leads for an ACM @ UIUC sub-organization.",
          params: z.object({
            orgId: z
              .enum(AllOrganizationList)
              .meta({ description: "ACM @ UIUC organization to modify." }),
          }),
          body: patchOrganizationLeadsBody,
          response: {
            201: {
              description: "The information was saved.",
              content: { "application/json": { schema: z.null() } },
            },
          },
        }),
        {
          disableApiKeyAuth: false,
          notes:
            "Authenticated leads of the organization without the appropriate role may also perform this action.",
        },
      ),
      onRequest: async (request, reply) => {
        await authorizeByOrgRoleOrSchema(fastify, request, reply, {
          validRoles: [{ org: request.params.orgId, role: "LEAD" }],
        });
      },
    },
    async (request, reply) => {
      const { add, remove } = request.body;
      const allUsernames = [...add.map((u) => u.username), ...remove];
      const officersEmail =
        notificationRecipients[fastify.runEnvironment].OfficerBoard;

      if (new Set(allUsernames).size !== allUsernames.length) {
        throw new ValidationError({
          message: "Each user can only be specified once.",
        });
      }

      if (add.length > 0) {
        try {
          const paidMemberships = await Promise.all(
            add.map((u) =>
              checkPaidMembership({
                netId: u.username.replace("@illinois.edu", ""),
                logger: request.log,
                dynamoClient: fastify.dynamoClient,
                redisClient: fastify.redisClient,
              }),
            ),
          );
          if (paidMemberships.some((p) => !p)) {
            throw new ValidationError({
              message:
                "One or more of the requested users to add are not ACM paid members.",
            });
          }
        } catch (e) {
          if (e instanceof BaseError) {
            throw e;
          }
          request.log.error(e);
          throw new InternalServerError({
            message: "Failed to check paid membership status.",
          });
        }
      }

      const getMetadataCommand = new GetItemCommand({
        TableName: genericConfig.SigInfoTableName,
        Key: marshall({
          primaryKey: `DEFINE#${request.params.orgId}`,
          entryId: "0",
        }),
        AttributesToGet: ["leadsEntraGroupId"],
        ConsistentRead: true,
      });

      const [metadataResponse, clients] = await Promise.all([
        fastify.dynamoClient.send(getMetadataCommand),
        getAuthorizedClients(),
      ]);
      let entraGroupId = metadataResponse.Item
        ? (unmarshall(metadataResponse.Item).leadsEntraGroupId as string)
        : undefined;

      let githubTeamId = metadataResponse.Item
        ? (unmarshall(metadataResponse.Item).githubTeamId as number)
        : undefined;

      let createdGithubTeam = false;

      const entraIdToken = await getEntraIdToken({
        clients,
        clientId: fastify.environmentConfig.AadValidClientId,
        secretName: genericConfig.EntraSecretName,
        logger: request.log,
      });

      const shouldCreateNewEntraGroup = !entraGroupId;
      const grpDisplayName = `${request.params.orgId} Admin`;
      const grpShortName = `${OrganizationShortIdentifierMapping[request.params.orgId as keyof typeof OrganizationShortIdentifierMapping]}-adm`;

      // Create external groups
      if (shouldCreateNewEntraGroup || !githubTeamId) {
        const timestamp = new Date().toISOString();
        const updates: Record<string, any> = { updatedAt: timestamp };
        const logStatements: TransactWriteItem[] = [];

        // Create Entra group if needed
        if (shouldCreateNewEntraGroup) {
          request.log.info(
            `No Entra group exists for ${request.params.orgId}. Creating new group...`,
          );

          try {
            const memberUpns = add.map((u) =>
              u.username.replace("@illinois.edu", "@acm.illinois.edu"),
            );

            entraGroupId = await createM365Group(
              entraIdToken,
              grpDisplayName,
              grpShortName,
              memberUpns,
              fastify.runEnvironment,
            );

            request.log.info(
              `Created Entra group ${entraGroupId} for ${request.params.orgId}`,
            );

            updates.leadsEntraGroupId = entraGroupId;
            const logStatement = buildAuditLogTransactPut({
              entry: {
                module: Modules.ORG_INFO,
                message: "Created Entra group for organization leads.",
                actor: request.username!,
                target: request.params.orgId,
              },
            });
            if (logStatement) {
              logStatements.push(logStatement);
            }

            // Update dynamic membership query
            const newQuery = await getLeadsM365DynamicQuery({
              dynamoClient: fastify.dynamoClient,
              includeGroupIds: [entraGroupId],
            });
            if (newQuery) {
              const groupToUpdate =
                fastify.runEnvironment === "prod"
                  ? execCouncilGroupId
                  : execCouncilTestingGroupId;
              request.log.info(
                "Changing Exec group membership dynamic query...",
              );
              await setGroupMembershipRule(
                entraIdToken,
                groupToUpdate,
                newQuery,
              );
              request.log.info("Changed Exec group membership dynamic query!");
            }
          } catch (e) {
            request.log.error(e, "Failed to create Entra group");
            throw new InternalServerError({
              message: "Failed to create Entra group for organization leads.",
            });
          }
        }

        // Create GitHub team if needed
        if (!githubTeamId) {
          request.log.info(
            `No GitHub team exists for ${request.params.orgId}. Creating new team...`,
          );
          const suffix = fastify.environmentConfig.GroupEmailSuffix;
          githubTeamId = await createGithubTeam({
            orgId: fastify.environmentConfig.GithubOrgName,
            githubToken: fastify.secretConfig.github_pat,
            parentTeamId: fastify.environmentConfig.ExecGithubTeam,
            name: `${grpShortName}${suffix === "" ? "" : `-${suffix}`}`,
            description: grpDisplayName,
            logger: request.log,
          });
          request.log.info(
            `Created GitHub team "${githubTeamId}" for ${request.params.orgId} leads.`,
          );
          createdGithubTeam = true;
          updates.leadsGithubTeamId = githubTeamId;
          const logStatement = buildAuditLogTransactPut({
            entry: {
              module: Modules.ORG_INFO,
              message: `Created GitHub team "${githubTeamId}" for organization leads.`,
              actor: request.username!,
              target: request.params.orgId,
            },
          });
          if (logStatement) {
            logStatements.push(logStatement);
          }
        }

        const storeIdsOperation = async () => {
          const commandTransaction = new TransactWriteItemsCommand({
            TransactItems: [
              ...logStatements,
              {
                Put: {
                  TableName: genericConfig.SigInfoTableName,
                  Item: marshall(
                    {
                      primaryKey: `DEFINE#${request.params.orgId}`,
                      entryId: "0",
                      ...updates,
                    },
                    { removeUndefinedValues: true },
                  ),
                },
              },
            ],
          });
          return await clients.dynamoClient.send(commandTransaction);
        };

        await retryDynamoTransactionWithBackoff(
          storeIdsOperation,
          request.log,
          `Store group IDs for ${request.params.orgId}`,
        );
      }

      const commonArgs = {
        orgId: request.params.orgId,
        actorUsername: request.username!,
        reqId: request.id,
        entraGroupId,
        entraIdToken,
        dynamoClient: fastify.dynamoClient,
        logger: request.log,
        officersEmail,
      };

      const addPromises = add.map((user) => addLead({ ...commonArgs, user }));
      const removePromises = remove.map((username) =>
        removeLead({ ...commonArgs, username }),
      );

      const results = await Promise.allSettled([
        ...addPromises,
        ...removePromises,
      ]);

      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        failures.forEach((f) =>
          request.log.error(
            (f as PromiseRejectedResult).reason,
            "Failed to update an org lead.",
          ),
        );
        throw new InternalServerError({
          message:
            "A partial failure occurred while updating organization leads.",
        });
      }

      const sqsPayloads = results
        .filter(
          (r): r is PromiseFulfilledResult<SQSMessage | null> =>
            r.status === "fulfilled",
        )
        .map((r) => r.value)
        .filter((p): p is SQSMessage => p !== null);

      if (sqsPayloads.length > 0) {
        if (!fastify.sqsClient) {
          fastify.sqsClient = new SQSClient({
            region: genericConfig.AwsRegion,
          });
        }
        await sendSqsMessagesInBatches({
          sqsClient: fastify.sqsClient,
          queueUrl: fastify.environmentConfig.SqsQueueUrl,
          logger: request.log,
          sqsPayloads,
        });
      }

      if (createdGithubTeam && fastify.environmentConfig.GithubIdpSyncEnabled) {
        request.log.info("Setting up IDP sync for Github team!");
        await assignIdpGroupsToTeam({
          githubToken: fastify.secretConfig.github_pat,
          teamId: githubTeamId,
          logger: request.log,
          groupsToSync: [entraGroupId].filter((x): x is string => !!x),
          orgId: fastify.environmentConfig.GithubOrgName,
        });
      } else {
        request.log.info(
          "IDP sync is disabled in this environment - the newly created group will have no members!",
        );
      }

      return reply.status(201).send();
    },
  );
};

export default organizationsPlugin;
