import { FastifyPluginAsync } from "fastify";
import * as z from "zod/v4";
import { AppRoles } from "../../common/roles.js";
import {
  BaseError,
  DatabaseDeleteError,
  DatabaseFetchError,
  DatabaseInsertError,
  NotFoundError,
  ValidationError,
} from "../../common/errors/index.js";
import {
  QueryCommand,
  TransactWriteItemsCommand,
  TransactWriteItem,
  TransactionCanceledException,
  ConditionalCheckFailedException,
  TransactWriteItemsCommandInput,
} from "@aws-sdk/client-dynamodb";
import { genericConfig } from "../../common/config.js";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import rateLimiter from "api/plugins/rateLimiter.js";
import {
  createOrgLinkRequest,
  createRequest,
  linkrySlug,
  orgLinkRecord,
} from "common/types/linkry.js";
import {
  extractUniqueSlugs,
  fetchOwnerRecords,
  getGroupsForSlugs,
  getFilteredUserGroups,
  getDelegatedLinks,
  fetchLinkEntry,
  getAllLinks,
  fetchOrgRecords,
  authorizeLinkAccess,
} from "api/functions/linkry.js";
import {
  buildAuditLogTransactPut,
  createAuditLogEntry,
} from "api/functions/auditLog.js";
import { Modules } from "common/modules.js";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import { withRoles, withTags } from "api/components/index.js";
import { Organizations } from "@acm-uiuc/js-shared";
import { authorizeByOrgRoleOrSchema } from "api/functions/authorization.js";
import { assertAuthenticated } from "api/authenticated.js";
import { NonAcmOrgUniqueId, OrgUniqueId } from "common/types/generic.js";

type OwnerRecord = {
  slug: string;
  redirect: string;
  access: string;
  updatedAt: string;
  createdAt: string;
};

type OrgRecord = {
  slug: string;
  redirect: string;
  access: string;
  updatedAt: string;
  createdAt: string;
  isOrgOwned?: boolean;
};

type AccessRecord = {
  slug: string;
  access: string;
  createdAt: string;
  updatedAt: string;
};

type LinkryGetRequest = {
  Params: { slug: string };
  Querystring: undefined;
  Body: undefined;
};

const linkryRoutes: FastifyPluginAsync = async (fastify, _options) => {
  const limitedRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.register(rateLimiter, {
      limit: 30,
      duration: 60,
      rateLimitIdentifier: "linkry",
    });

    fastify.get(
      "/redir",
      {
        schema: withRoles(
          [AppRoles.LINKS_MANAGER, AppRoles.LINKS_ADMIN],
          withTags(["Linkry"], {}),
        ),
        onRequest: fastify.authorizeFromSchema,
      },
      assertAuthenticated(async (request, reply) => {
        const username = request.username;
        const tableName = genericConfig.LinkryDynamoTableName;

        // First try-catch: Fetch owner records
        let ownerRecords;
        try {
          ownerRecords = await fetchOwnerRecords(
            username,
            tableName,
            fastify.dynamoClient,
          );
        } catch (error) {
          request.log.error(
            `Failed to fetch owner records: ${error instanceof Error ? error.toString() : "Unknown error"}`,
          );
          throw new DatabaseFetchError({
            message: "Failed to fetch owner records from Dynamo table.",
          });
        }

        const ownedUniqueSlugs = extractUniqueSlugs(ownerRecords);

        // Second try-catch: Get groups for slugs
        let ownedLinksWithGroups;
        try {
          ownedLinksWithGroups = await getGroupsForSlugs(
            ownedUniqueSlugs,
            ownerRecords,
            tableName,
            fastify.dynamoClient,
          );
        } catch (error) {
          request.log.error(
            `Failed to get groups for slugs: ${error instanceof Error ? error.toString() : "Unknown error"}`,
          );
          throw new DatabaseFetchError({
            message: "Failed to get groups for links from Dynamo table.",
          });
        }

        // Third try-catch paths: Get delegated links based on user role
        let delegatedLinks;
        if (request.userRoles.has(AppRoles.LINKS_ADMIN)) {
          // Admin path
          try {
            delegatedLinks = (
              await getAllLinks(tableName, fastify.dynamoClient)
            ).filter((x) => x.owner !== username && !x.isOrgOwned);
          } catch (error) {
            request.log.error(
              `Failed to get all links for admin: ${error instanceof Error ? error.toString() : "Unknown error"}`,
            );
            throw new DatabaseFetchError({
              message: "Failed to get all links for admin from Dynamo table.",
            });
          }
        } else {
          // Regular user path
          const userGroups = getFilteredUserGroups(request);
          try {
            delegatedLinks = await getDelegatedLinks(
              userGroups,
              ownedUniqueSlugs,
              tableName,
              fastify.dynamoClient,
              request.log,
            );
          } catch (error) {
            request.log.error(
              `Failed to get delegated links: ${error instanceof Error ? error.toString() : "Unknown error"}`,
            );
            throw new DatabaseFetchError({
              message: "Failed to get delegated links from Dynamo table.",
            });
          }
        }

        // Send the response
        reply.code(200).send({
          ownedLinks: ownedLinksWithGroups,
          delegatedLinks,
        });
      }),
    );

    fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
      "/redir",
      {
        schema: withRoles(
          [AppRoles.LINKS_MANAGER, AppRoles.LINKS_ADMIN],
          withTags(["Linkry"], {
            body: createRequest,
          }),
        ),
        preValidation: async (request, reply) => {
          const routeAlreadyExists = fastify.hasRoute({
            url: `/${request.body.slug}`,
            method: "GET",
          });

          if (routeAlreadyExists) {
            throw new ValidationError({
              message: `Slug ${request.body.slug} is reserved by the system.`,
            });
          }
        },
        onRequest: fastify.authorizeFromSchema,
      },
      assertAuthenticated(async (request, reply) => {
        const { slug } = request.body;
        const tableName = genericConfig.LinkryDynamoTableName;
        const currentRecord = await fetchLinkEntry(
          slug,
          tableName,
          fastify.dynamoClient,
        );
        if (currentRecord) {
          authorizeLinkAccess(request, currentRecord);
        }

        // Use a transaction to handle if one/multiple of these writes fail
        const TransactItems: TransactWriteItem[] = [];

        try {
          const mode = currentRecord ? "modify" : "create";
          request.log.info(`Operating in ${mode} mode.`);
          const currentUpdatedAt =
            currentRecord && currentRecord.updatedAt
              ? currentRecord.updatedAt
              : null;
          const currentCreatedAt =
            currentRecord && currentRecord.createdAt
              ? currentRecord.createdAt
              : null;

          // Generate new timestamp for all records
          const creationTime: Date = new Date();
          const newUpdatedAt = creationTime.toISOString();
          const newCreatedAt = currentCreatedAt || newUpdatedAt;
          const queryCommand = new QueryCommand({
            TableName: genericConfig.LinkryDynamoTableName,
            KeyConditionExpression:
              "slug = :slug AND begins_with(access, :accessPrefix)",
            ExpressionAttributeValues: marshall(
              {
                ":slug": request.body.slug,
                ":accessPrefix": "GROUP#",
              },
              { removeUndefinedValues: true },
            ),
          });

          const existingGroups = await fastify.dynamoClient.send(queryCommand);
          const existingGroupSet = new Set<string>();

          if (existingGroups.Items && existingGroups.Items.length > 0) {
            for (const item of existingGroups.Items) {
              const unmarshalledItem = unmarshall(item);
              existingGroupSet.add(unmarshalledItem.access);
            }
          }

          // Determine the owner for the record
          // If modifying, preserve the original owner; if creating, use current user
          const recordOwner = currentRecord
            ? currentRecord.owner
            : request.username;

          const ownerRecord: OwnerRecord = {
            slug: request.body.slug,
            redirect: request.body.redirect,
            access: `OWNER#${recordOwner}`,
            updatedAt: newUpdatedAt,
            createdAt: newCreatedAt,
          };

          // Add the OWNER record with a condition check to ensure it hasn't been modified
          // This is the only place we need optimistic locking
          const ownerPutItem: TransactWriteItem = {
            Put: {
              TableName: genericConfig.LinkryDynamoTableName,
              Item: marshall(ownerRecord, { removeUndefinedValues: true }),
              ...(mode === "modify"
                ? {
                    ConditionExpression: "updatedAt = :updatedAt",
                    ExpressionAttributeValues: marshall({
                      ":updatedAt": currentUpdatedAt,
                    }),
                  }
                : {}),
            },
          };

          TransactItems.push(ownerPutItem);

          // Add new GROUP records
          const accessGroups: string[] = request.body.access || [];
          const newGroupSet = new Set(
            accessGroups.map((group) => `GROUP#${group}`),
          );

          // Add new GROUP records that don't already exist
          for (const accessGroup of accessGroups) {
            const groupKey = `GROUP#${accessGroup}`;

            if (existingGroupSet.has(groupKey)) {
              // Update existing GROUP record with new updatedAt (no condition check)
              const updateItem: TransactWriteItem = {
                Update: {
                  TableName: genericConfig.LinkryDynamoTableName,
                  Key: marshall({
                    slug: request.body.slug,
                    access: groupKey,
                  }),
                  UpdateExpression: "SET updatedAt = :updatedAt",
                  ExpressionAttributeValues: marshall({
                    ":updatedAt": newUpdatedAt,
                  }),
                },
              };

              TransactItems.push(updateItem);
            } else {
              // Create new GROUP record
              const groupRecord: AccessRecord = {
                slug: request.body.slug,
                access: groupKey,
                updatedAt: newUpdatedAt,
                createdAt: newCreatedAt,
              };

              const groupPutItem: TransactWriteItem = {
                Put: {
                  TableName: genericConfig.LinkryDynamoTableName,
                  Item: marshall(groupRecord, { removeUndefinedValues: true }),
                },
              };

              TransactItems.push(groupPutItem);
            }
          }

          // Delete GROUP records that are no longer needed (no condition check)
          for (const existingGroup of existingGroupSet) {
            // Skip if this is a group we want to keep
            if (newGroupSet.has(existingGroup)) {
              continue;
            }

            const deleteItem: TransactWriteItem = {
              Delete: {
                TableName: genericConfig.LinkryDynamoTableName,
                Key: marshall({
                  slug: request.body.slug,
                  access: existingGroup,
                }),
              },
            };

            TransactItems.push(deleteItem);
          }
          await fastify.dynamoClient.send(
            new TransactWriteItemsCommand({ TransactItems }),
          );
        } catch (e) {
          fastify.log.error(e);
          // Handle optimistic concurrency control
          if (
            e instanceof TransactionCanceledException &&
            e.CancellationReasons &&
            e.CancellationReasons.some(
              (reason) => reason.Code === "ConditionalCheckFailed",
            )
          ) {
            for (const reason of e.CancellationReasons) {
              request.log.error(`Cancellation reason: ${reason.Message}`);
            }
            throw new ValidationError({
              message:
                "The record was modified by another process. Please try again.",
            });
          }

          if (e instanceof BaseError) {
            throw e;
          }

          throw new DatabaseInsertError({
            message: "Failed to save data to DynamoDB.",
          });
        }
        await createAuditLogEntry({
          dynamoClient: fastify.dynamoClient,
          entry: {
            module: Modules.LINKRY,
            actor: request.username,
            target: request.body.slug,
            message: `Created redirect to "${request.body.redirect}"`,
          },
        });
        return reply.status(201).send();
      }),
    );

    fastify.get<LinkryGetRequest>(
      "/redir/:slug",
      {
        schema: withRoles(
          [AppRoles.LINKS_MANAGER, AppRoles.LINKS_ADMIN],
          withTags(["Linkry"], {
            params: z.object({
              slug: linkrySlug,
            }),
          }),
        ),
        onRequest: fastify.authorizeFromSchema,
      },
      assertAuthenticated(async (request, reply) => {
        try {
          const { slug } = request.params;
          const tableName = genericConfig.LinkryDynamoTableName;
          const item = await fetchLinkEntry(
            slug,
            tableName,
            fastify.dynamoClient,
          );

          if (!item) {
            throw new NotFoundError({ endpointName: request.url });
          }

          authorizeLinkAccess(request, item);

          return reply.status(200).send(item);
        } catch (e: unknown) {
          fastify.log.error(e);
          if (e instanceof BaseError) {
            throw e;
          }
          throw new DatabaseFetchError({
            message: "Failed to fetch slug information in Dynamo table.",
          });
        }
      }),
    );

    fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().delete(
      "/redir/:slug",
      {
        schema: withRoles(
          [AppRoles.LINKS_MANAGER, AppRoles.LINKS_ADMIN],
          withTags(["Linkry"], {
            params: z.object({
              slug: linkrySlug,
            }),
          }),
        ),
        onRequest: fastify.authorizeFromSchema,
      },
      assertAuthenticated(async (request, reply) => {
        const { slug } = request.params;
        const tableName = genericConfig.LinkryDynamoTableName;
        const currentRecord = await fetchLinkEntry(
          slug,
          tableName,
          fastify.dynamoClient,
        );

        if (!currentRecord) {
          throw new NotFoundError({ endpointName: request.url });
        }

        authorizeLinkAccess(request, currentRecord);

        const TransactItems: TransactWriteItem[] = [
          // Delete GROUP records without condition check
          ...currentRecord.access.map((x) => ({
            Delete: {
              TableName: genericConfig.LinkryDynamoTableName,
              Key: {
                slug: { S: slug },
                access: { S: `GROUP#${x}` },
              },
            },
          })),
          // Delete OWNER record with condition check for optimistic locking
          {
            Delete: {
              TableName: genericConfig.LinkryDynamoTableName,
              Key: {
                slug: { S: slug },
                access: { S: `OWNER#${currentRecord.owner}` },
              },
              ConditionExpression: "updatedAt = :updatedAt",
              ExpressionAttributeValues: marshall({
                ":updatedAt": currentRecord.updatedAt,
              }),
            },
          },
        ];

        try {
          await fastify.dynamoClient.send(
            new TransactWriteItemsCommand({ TransactItems }),
          );
        } catch (e) {
          fastify.log.error(e);
          // Handle optimistic concurrency control
          if (
            e instanceof TransactionCanceledException &&
            e.CancellationReasons &&
            e.CancellationReasons.some(
              (reason) => reason.Code === "ConditionalCheckFailed",
            )
          ) {
            for (const reason of e.CancellationReasons) {
              request.log.error(`Cancellation reason: ${reason.Message}`);
            }
            throw new ValidationError({
              message:
                "The record was modified by another process. Please try again.",
            });
          }

          if (e instanceof BaseError) {
            throw e;
          }

          throw new DatabaseDeleteError({
            message: "Failed to delete data from DynamoDB.",
          });
        }
        await createAuditLogEntry({
          dynamoClient: fastify.dynamoClient,
          entry: {
            module: Modules.LINKRY,
            actor: request.username,
            target: slug,
            message: `Deleted short link redirect.`,
          },
        });
        reply.code(204).send();
      }),
    );

    fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
      "/orgs/:orgId/redir",
      {
        schema: withRoles(
          [AppRoles.AT_LEAST_ONE_ORG_MANAGER, AppRoles.LINKS_ADMIN],
          withTags(["Linkry"], {
            body: createOrgLinkRequest,
            params: z.object({
              orgId: NonAcmOrgUniqueId,
            }),
            summary: "Create a short link for a specific org",
            response: {
              201: {
                description: "The short link was modified.",
                content: {
                  "application/json": {
                    schema: z.undefined(),
                  },
                },
              },
            },
          }),
        ),
        preValidation: async (request, reply) => {
          const routeAlreadyExists = fastify.hasRoute({
            url: `/${request.params.orgId}#${request.body.slug}`,
            method: "GET",
          });

          if (routeAlreadyExists) {
            throw new ValidationError({
              message: `Slug ${request.params.orgId}#${request.body.slug} is reserved by the system.`,
            });
          }
        },
        onRequest: async (request, reply) => {
          await authorizeByOrgRoleOrSchema(fastify, request, reply, {
            validRoles: [{ org: request.params.orgId, role: "LEAD" }],
          });
        },
      },
      assertAuthenticated(async (request, reply) => {
        const { slug, redirect } = request.body;
        const tableName = genericConfig.LinkryDynamoTableName;
        const realSlug = `${request.params.orgId}#${slug}`;
        const currentRecord = await fetchLinkEntry(
          realSlug,
          tableName,
          fastify.dynamoClient,
        );

        try {
          const mode = currentRecord ? "modify" : "create";
          request.log.info(`Operating in ${mode} mode.`);
          const currentUpdatedAt =
            currentRecord && currentRecord.updatedAt
              ? currentRecord.updatedAt
              : null;
          const currentCreatedAt =
            currentRecord && currentRecord.createdAt
              ? currentRecord.createdAt
              : null;

          const creationTime: Date = new Date();
          const newUpdatedAt = creationTime.toISOString();
          const newCreatedAt = currentCreatedAt || newUpdatedAt;

          const ownerRecord: OrgRecord = {
            slug: realSlug,
            redirect,
            access: `OWNER#${request.params.orgId}`, // org records are owned by the org
            updatedAt: newUpdatedAt,
            createdAt: newCreatedAt,
            isOrgOwned: true,
          };

          // Add the OWNER record with a condition check to ensure it hasn't been modified

          const ownerPutParams = {
            Put: {
              TableName: genericConfig.LinkryDynamoTableName,
              Item: marshall(ownerRecord, { removeUndefinedValues: true }),
              ...(mode === "modify"
                ? {
                    ConditionExpression: "updatedAt = :updatedAt",
                    ExpressionAttributeValues: marshall({
                      ":updatedAt": currentUpdatedAt,
                    }),
                  }
                : {}),
            },
          };

          const auditLogItem = buildAuditLogTransactPut({
            entry: {
              module: Modules.LINKRY,
              actor: request.username,
              target: `${Organizations[request.params.orgId].name}/${request.body.slug}`,
              requestId: request.id,
              message: `Created redirect to ${redirect}`,
            },
          });
          const transaction: TransactWriteItemsCommandInput["TransactItems"] = [
            ownerPutParams,
          ];
          if (auditLogItem) {
            transaction.push(auditLogItem);
          }
          await fastify.dynamoClient.send(
            new TransactWriteItemsCommand({ TransactItems: transaction }),
          );
        } catch (e) {
          fastify.log.error(e);
          if (e instanceof ConditionalCheckFailedException) {
            throw new ValidationError({
              message:
                "The record was modified by another process. Please try again.",
            });
          }

          if (e instanceof BaseError) {
            throw e;
          }

          throw new DatabaseInsertError({
            message: "Failed to save data to DynamoDB.",
          });
        }
        const newResourceUrl = `${request.url}/slug/${request.body.slug}`;
        return reply.status(201).headers({ location: newResourceUrl }).send();
      }),
    );
    fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
      "/orgs/:orgId/redir",
      {
        schema: withRoles(
          [AppRoles.AT_LEAST_ONE_ORG_MANAGER, AppRoles.LINKS_ADMIN],
          withTags(["Linkry"], {
            params: z.object({
              orgId: NonAcmOrgUniqueId,
            }),
            summary: "Retrieve short link for a specific org",
            response: {
              200: {
                description: "The short links were retrieved.",
                content: {
                  "application/json": {
                    schema: z.array(orgLinkRecord),
                  },
                },
              },
            },
          }),
        ),
        onRequest: async (request, reply) => {
          await authorizeByOrgRoleOrSchema(fastify, request, reply, {
            validRoles: [{ org: request.params.orgId, role: "LEAD" }],
          });
        },
      },
      assertAuthenticated(async (request, reply) => {
        let orgRecords;
        try {
          orgRecords = await fetchOrgRecords(
            request.params.orgId,
            genericConfig.LinkryDynamoTableName,
            fastify.dynamoClient,
          );
        } catch (e) {
          if (e instanceof BaseError) {
            throw e;
          }
          request.log.error(e);
          throw new DatabaseFetchError({
            message: "Failed to get links for org.",
          });
        }
        return reply.status(200).send(orgRecords);
      }),
    );
    fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().delete(
      "/orgs/:orgId/redir/:slug",
      {
        schema: withRoles(
          [AppRoles.AT_LEAST_ONE_ORG_MANAGER, AppRoles.LINKS_ADMIN],
          withTags(["Linkry"], {
            params: z.object({
              orgId: NonAcmOrgUniqueId,
              slug: linkrySlug,
            }),
            summary: "Delete a short link for a specific org",
            response: {
              204: {
                description: "The short links was deleted.",
                content: {
                  "application/json": {
                    schema: z.undefined(),
                  },
                },
              },
            },
          }),
        ),
        onRequest: async (request, reply) => {
          await authorizeByOrgRoleOrSchema(fastify, request, reply, {
            validRoles: [{ org: request.params.orgId, role: "LEAD" }],
          });
        },
      },
      assertAuthenticated(async (request, reply) => {
        const realSlug = `${request.params.orgId}#${request.params.slug}`;
        try {
          const tableName = genericConfig.LinkryDynamoTableName;
          const currentRecord = await fetchLinkEntry(
            realSlug,
            tableName,
            fastify.dynamoClient,
          );
          if (!currentRecord) {
            throw new NotFoundError({ endpointName: request.url });
          }
        } catch (e) {
          if (e instanceof BaseError) {
            throw e;
          }
          request.log.error(e);
          throw new DatabaseFetchError({
            message: "Failed to get link.",
          });
        }
        const logStatement = buildAuditLogTransactPut({
          entry: {
            module: Modules.LINKRY,
            actor: request.username,
            target: `${Organizations[request.params.orgId].name}/${request.params.slug}`,
            message: `Deleted short link redirect.`,
          },
        });
        const TransactItems: TransactWriteItem[] = [
          ...(logStatement ? [logStatement] : []),
          {
            Delete: {
              TableName: genericConfig.LinkryDynamoTableName,
              Key: {
                slug: { S: realSlug },
                access: { S: `OWNER#${request.params.orgId}` },
              },
            },
          },
        ];

        try {
          await fastify.dynamoClient.send(
            new TransactWriteItemsCommand({ TransactItems }),
          );
        } catch (e) {
          fastify.log.error(e);
          if (e instanceof BaseError) {
            throw e;
          }

          throw new DatabaseDeleteError({
            message: "Failed to delete data from DynamoDB.",
          });
        }
        return reply.status(204).send();
      }),
    );
  };
  fastify.register(limitedRoutes);
};

export default linkryRoutes;
