import { FastifyPluginAsync } from "fastify";
import { AppRoles } from "../../common/roles.js";
import {
  addToTenant,
  getEntraIdToken,
  getGroupMetadata,
  getServicePrincipalOwnedGroups,
  listGroupMembers,
  modifyGroup,
  patchUserProfile,
} from "../functions/entraId.js";
import {
  BaseError,
  DatabaseFetchError,
  DatabaseInsertError,
  EntraGroupError,
  EntraInvitationError,
  InternalServerError,
  NotFoundError,
} from "../../common/errors/index.js";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import {
  GENERIC_CACHE_SECONDS,
  genericConfig,
  roleArns,
} from "../../common/config.js";
import { marshall } from "@aws-sdk/util-dynamodb";
import {
  invitePostRequestSchema,
  groupMappingCreatePostSchema,
  groupModificationPatchSchema,
  EntraGroupActions,
  entraProfilePatchRequest,
} from "../../common/types/iam.js";
import { clearAuthCache, getGroupRoles } from "../functions/authorization.js";
import { getRoleCredentials } from "api/functions/sts.js";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { createAuditLogEntry } from "api/functions/auditLog.js";
import { Modules } from "common/modules.js";
import { groupId, withRoles, withTags } from "api/components/index.js";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import * as z from "zod/v4";
import { AvailableSQSFunctions } from "common/types/sqsMessage.js";
import { SendMessageBatchCommand, SQSClient } from "@aws-sdk/client-sqs";
import { randomUUID } from "crypto";
import { getKey, setKey } from "api/functions/redisCache.js";

const iamRoutes: FastifyPluginAsync = async (fastify, _options) => {
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
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().patch(
    "/profile",
    {
      schema: withRoles(
        [],
        withTags(["IAM"], {
          body: entraProfilePatchRequest,
          summary: "Update user's profile.",
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      if (!request.tokenPayload || !request.username) {
        throw new InternalServerError({
          message: "Could not find token payload and/or username.",
        });
      }
      const userOid = request.tokenPayload.oid;
      const entraIdToken = await getEntraIdToken({
        clients: await getAuthorizedClients(),
        clientId: fastify.environmentConfig.AadValidClientId,
        secretName: genericConfig.EntraSecretName,
        logger: request.log,
      });
      await patchUserProfile(
        entraIdToken,
        request.username,
        userOid,
        request.body,
      );
      reply.status(201).send();
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/groups/:groupId/roles",
    {
      schema: withRoles(
        [AppRoles.IAM_ADMIN],
        withTags(["IAM"], {
          params: z.object({
            groupId,
          }),
          summary: "Get a group's application role mappings.",
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      try {
        const groupId = request.params.groupId;
        const roles = await getGroupRoles(fastify.dynamoClient, groupId);
        return reply.send(roles);
      } catch (e: unknown) {
        if (e instanceof BaseError) {
          throw e;
        }

        request.log.error(e);
        throw new DatabaseFetchError({
          message: "An error occurred finding the group role mapping.",
        });
      }
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/groups/:groupId/roles",
    {
      schema: withRoles(
        [AppRoles.IAM_ADMIN],
        withTags(["IAM"], {
          params: z.object({
            groupId,
          }),
          body: groupMappingCreatePostSchema,
          summary: "Update a group's application role mappings.",
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      const groupId = (request.params as Record<string, string>).groupId;
      try {
        const timestamp = new Date().toISOString();
        const entraIdToken = await getEntraIdToken({
          clients: await getAuthorizedClients(),
          clientId: fastify.environmentConfig.AadValidClientId,
          secretName: genericConfig.EntraSecretName,
          logger: request.log,
        });
        const groupMembers = listGroupMembers(entraIdToken, groupId);
        const command = new PutItemCommand({
          TableName: `${genericConfig.IAMTablePrefix}-grouproles`,
          Item: marshall({
            groupUuid: groupId,
            roles: request.body.roles,
            createdAt: timestamp,
          }),
        });
        const logPromise = createAuditLogEntry({
          dynamoClient: fastify.dynamoClient,
          entry: {
            module: Modules.IAM,
            actor: request.username!,
            target: groupId,
            message: `set target roles to ${request.body.roles.toString()}`,
            requestId: request.id,
          },
        });
        await fastify.dynamoClient.send(command);
        await logPromise;
        fastify.nodeCache.set(
          `grouproles-${groupId}`,
          request.body.roles,
          GENERIC_CACHE_SECONDS,
        );
        const groupMemberEmails = (await groupMembers).map((x) => x.email);
        await clearAuthCache({
          redisClient: fastify.redisClient,
          username: groupMemberEmails,
          logger: request.log,
        });
        reply.send({ message: "OK" });
      } catch (e: unknown) {
        fastify.nodeCache.del(`grouproles-${groupId}`);
        if (e instanceof BaseError) {
          throw e;
        }

        request.log.error(e);
        throw new DatabaseInsertError({
          message: "Could not create group role mapping.",
        });
      }
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/inviteUsers",
    {
      schema: withRoles(
        [AppRoles.IAM_INVITE_ONLY, AppRoles.IAM_ADMIN],
        withTags(["IAM"], {
          body: invitePostRequestSchema,
          summary: "Invite a user to the ACM @ UIUC Entra ID tenant.",
          // response: { 202: entraActionResponseSchema },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      const emails = request.body.emails;
      const entraIdToken = await getEntraIdToken({
        clients: await getAuthorizedClients(),
        clientId: fastify.environmentConfig.AadValidClientId,
        secretName: genericConfig.EntraSecretName,
        logger: request.log,
      });
      if (!entraIdToken) {
        throw new InternalServerError({
          message: "Could not get Entra ID token to perform task.",
        });
      }
      const response: Record<string, Record<string, string>[]> = {
        success: [],
        failure: [],
      };
      const results = await Promise.allSettled(
        emails.map((email) => addToTenant(entraIdToken, email)),
      );
      const logPromises = [];
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === "fulfilled") {
          logPromises.push(
            createAuditLogEntry({
              dynamoClient: fastify.dynamoClient,
              entry: {
                module: Modules.IAM,
                actor: request.username!,
                target: emails[i],
                message: "Invited user to Entra ID tenant.",
                requestId: request.id,
              },
            }),
          );
          response.success.push({ email: emails[i] });
        } else {
          logPromises.push(
            createAuditLogEntry({
              dynamoClient: fastify.dynamoClient,
              entry: {
                module: Modules.IAM,
                actor: request.username!,
                target: emails[i],
                message: "Failed to invite user to Entra ID tenant.",
                requestId: request.id,
              },
            }),
          );
          if (result.reason instanceof EntraInvitationError) {
            response.failure.push({
              email: emails[i],
              message: result.reason.message,
            });
          } else {
            response.failure.push({
              email: emails[i],
              message: "An unknown error occurred.",
            });
          }
        }
      }
      await Promise.allSettled(logPromises);
      reply.status(202).send(response);
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().patch(
    "/groups/:groupId",
    {
      schema: withRoles(
        [AppRoles.IAM_ADMIN],
        withTags(["IAM"], {
          params: z.object({
            groupId,
          }),
          body: groupModificationPatchSchema,
          summary: "Update the members of a group.",
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      const groupId = (request.params as Record<string, string>).groupId;
      if (!groupId || groupId === "") {
        throw new NotFoundError({
          endpointName: request.url,
        });
      }
      if (genericConfig.ProtectedEntraIDGroups.includes(groupId)) {
        throw new EntraGroupError({
          code: 403,
          message:
            "This group is protected and cannot be modified by this service. You must log into Entra ID directly to modify this group.",
          group: groupId,
        });
      }
      const entraIdToken = await getEntraIdToken({
        clients: await getAuthorizedClients(),
        clientId: fastify.environmentConfig.AadValidClientId,
        secretName: genericConfig.EntraSecretName,
        logger: request.log,
      });
      const groupMetadataPromise = getGroupMetadata(entraIdToken, groupId);
      const addResults = await Promise.allSettled(
        request.body.add.map((email) =>
          modifyGroup(
            entraIdToken,
            email,
            groupId,
            EntraGroupActions.ADD,
            fastify.dynamoClient,
          ),
        ),
      );
      const removeResults = await Promise.allSettled(
        request.body.remove.map((email) =>
          modifyGroup(
            entraIdToken,
            email,
            groupId,
            EntraGroupActions.REMOVE,
            fastify.dynamoClient,
          ),
        ),
      );
      const groupMetadata = await groupMetadataPromise;
      const response: Record<string, Record<string, string>[]> = {
        success: [],
        failure: [],
      };
      const logPromises = [];
      const addedEmails = [];
      const removedEmails = [];
      for (let i = 0; i < addResults.length; i++) {
        const result = addResults[i];
        if (result.status === "fulfilled") {
          response.success.push({ email: request.body.add[i] });
          addedEmails.push(request.body.add[i]);
          logPromises.push(
            createAuditLogEntry({
              dynamoClient: fastify.dynamoClient,
              entry: {
                module: Modules.IAM,
                actor: request.username!,
                target: request.body.add[i],
                message: `added target to group ID ${groupId}`,
                requestId: request.id,
              },
            }),
          );
        } else {
          logPromises.push(
            createAuditLogEntry({
              dynamoClient: fastify.dynamoClient,
              entry: {
                module: Modules.IAM,
                actor: request.username!,
                target: request.body.add[i],
                message: `failed to add target to group ID ${groupId}`,
                requestId: request.id,
              },
            }),
          );
          if (result.reason instanceof EntraGroupError) {
            response.failure.push({
              email: request.body.add[i],
              message: result.reason.message,
            });
          } else {
            response.failure.push({
              email: request.body.add[i],
              message: "An unknown error occurred.",
            });
          }
        }
      }
      for (let i = 0; i < removeResults.length; i++) {
        const result = removeResults[i];
        if (result.status === "fulfilled") {
          response.success.push({ email: request.body.remove[i] });
          removedEmails.push(request.body.remove[i]);
          logPromises.push(
            createAuditLogEntry({
              dynamoClient: fastify.dynamoClient,
              entry: {
                module: Modules.IAM,
                actor: request.username!,
                target: request.body.remove[i],
                message: `remove target from group ID ${groupId}`,
                requestId: request.id,
              },
            }),
          );
        } else {
          logPromises.push(
            createAuditLogEntry({
              dynamoClient: fastify.dynamoClient,
              entry: {
                module: Modules.IAM,
                actor: request.username!,
                target: request.body.remove[i],
                message: `failed to remove target from group ID ${groupId}`,
                requestId: request.id,
              },
            }),
          );
          if (result.reason instanceof EntraGroupError) {
            response.failure.push({
              email: request.body.remove[i],
              message: result.reason.message,
            });
          } else {
            response.failure.push({
              email: request.body.remove[i],
              message: "An unknown error occurred.",
            });
          }
        }
      }
      const sqsAddedPayloads = addedEmails
        .filter((x) => !!x)
        .map((x) => {
          return {
            function: AvailableSQSFunctions.EmailNotifications,
            metadata: {
              initiator: request.username!,
              reqId: request.id,
            },
            payload: {
              to: [x],
              subject: "You have been added to an access group",
              content: `
Hello,

We're letting you know that you have been added to the "${groupMetadata.displayName}" access group by ${request.username}. Changes may take up to 2 hours to reflect in all systems.

No action is required from you at this time.
          `,
            },
          };
        });
      const sqsRemovedPayloads = removedEmails
        .filter((x) => !!x)
        .map((x) => {
          return {
            function: AvailableSQSFunctions.EmailNotifications,
            metadata: {
              initiator: request.username!,
              reqId: request.id,
            },
            payload: {
              to: [x],
              subject: "You have been removed from an access group",
              content: `
Hello,

We're letting you know that you have been removed from the "${groupMetadata.displayName}" access group by ${request.username}.

No action is required from you at this time.
          `,
            },
          };
        });
      if (!fastify.sqsClient) {
        fastify.sqsClient = new SQSClient({
          region: genericConfig.AwsRegion,
        });
      }
      if (sqsAddedPayloads.length > 0) {
        request.log.debug("Sending added emails");
        let chunkId = 0;
        for (let i = 0; i < sqsAddedPayloads.length; i += 10) {
          chunkId += 1;
          const chunk = sqsAddedPayloads.slice(i, i + 10);
          const removedQueued = await fastify.sqsClient.send(
            new SendMessageBatchCommand({
              QueueUrl: fastify.environmentConfig.SqsQueueUrl,
              Entries: chunk.map((x) => ({
                Id: randomUUID(),
                MessageBody: JSON.stringify(x),
              })),
            }),
          );
          request.log.info(
            `Sent added emails chunk ${chunkId}, queue ID ${removedQueued.$metadata.requestId}`,
          );
        }
      }
      if (sqsRemovedPayloads.length > 0) {
        request.log.debug("Sending removed emails");
        let chunkId = 0;
        for (let i = 0; i < sqsRemovedPayloads.length; i += 10) {
          chunkId += 1;
          const chunk = sqsRemovedPayloads.slice(i, i + 10);
          const removedQueued = await fastify.sqsClient.send(
            new SendMessageBatchCommand({
              QueueUrl: fastify.environmentConfig.SqsQueueUrl,
              Entries: chunk.map((x) => ({
                Id: randomUUID(),
                MessageBody: JSON.stringify(x),
              })),
            }),
          );
          request.log.info(
            `Sent removed emails chunk ${chunkId}, queue ID ${removedQueued.$metadata.requestId}`,
          );
        }
      }
      const allEmailsModified = response.success.map((x) => x.email);
      const { redisClient } = fastify;
      const { log: logger } = request;
      await clearAuthCache({
        redisClient,
        username: allEmailsModified,
        logger,
      });
      await Promise.allSettled(logPromises);
      reply.status(202).send(response);
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/groups/:groupId",
    {
      schema: withRoles(
        [AppRoles.IAM_ADMIN],
        withTags(["IAM"], {
          // response: { 200: entraGroupMembershipListResponse },
          params: z.object({
            groupId,
          }),
          summary: "Get the members of a group.",
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      const groupId = (request.params as Record<string, string>).groupId;
      if (!groupId || groupId === "") {
        throw new NotFoundError({
          endpointName: request.url,
        });
      }
      if (genericConfig.ProtectedEntraIDGroups.includes(groupId)) {
        throw new EntraGroupError({
          code: 403,
          message:
            "This group is protected and cannot be read by this service. You must log into Entra ID directly to read this group.",
          group: groupId,
        });
      }
      const entraIdToken = await getEntraIdToken({
        clients: await getAuthorizedClients(),
        clientId: fastify.environmentConfig.AadValidClientId,
        secretName: genericConfig.EntraSecretName,
        logger: request.log,
      });
      const response = await listGroupMembers(entraIdToken, groupId);
      reply.status(200).send(response);
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/groups",
    {
      schema: withRoles(
        [AppRoles.IAM_ADMIN],
        withTags(["IAM"], {
          summary: "Get all manageable groups.", // This is all groups where the Core API service principal is an owner.
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      const { redisClient } = fastify;
      const key = `entra_manageable_groups_${fastify.environmentConfig.EntraServicePrincipalId}`;
      const redisResponse = await getKey<{ displayName: string; id: string }[]>(
        { redisClient, key, logger: request.log },
      );
      if (redisResponse) {
        request.log.debug("Got manageable groups from Redis cache.");
        return reply
          .header("X-ACM-Data-Source", "redis")
          .status(200)
          .send(redisResponse);
      }
      const entraIdToken = await getEntraIdToken({
        clients: await getAuthorizedClients(),
        clientId: fastify.environmentConfig.AadValidClientId,
        secretName: genericConfig.EntraSecretName,
        logger: request.log,
      });
      // get groups, but don't show protected groups as manageable
      const freshData = (
        await getServicePrincipalOwnedGroups(
          entraIdToken,
          fastify.environmentConfig.EntraServicePrincipalId,
        )
      ).filter(
        (x) =>
          !genericConfig.ProtectedEntraIDGroups.includes(x.id) &&
          x.id !== fastify.environmentConfig.PaidMemberGroupId,
      );
      request.log.debug(
        "Got manageable groups from Entra ID, setting to cache.",
      );
      await setKey({
        redisClient,
        key,
        data: JSON.stringify(freshData),
        expiresIn: GENERIC_CACHE_SECONDS,
        logger: request.log,
      });
      return reply.status(200).send(freshData);
    },
  );
};

export default iamRoutes;
