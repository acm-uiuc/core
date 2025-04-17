import { FastifyPluginAsync } from "fastify";
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
} from "@aws-sdk/client-dynamodb";
import { CloudFrontKeyValueStoreClient } from "@aws-sdk/client-cloudfront-keyvaluestore";
import {
  genericConfig,
  EVENT_CACHED_DURATION,
  LinkryGroupUUIDToGroupNameMap,
} from "../../common/config.js";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import rateLimiter from "api/plugins/rateLimiter.js";
import {
  deleteKey,
  getLinkryKvArn,
  setKey,
} from "api/functions/cloudfrontKvStore.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { createRequest, getRequest } from "common/types/linkry.js";
import {
  extractUniqueSlugs,
  fetchOwnerRecords,
  getGroupsForSlugs,
  getFilteredUserGroups,
  getDelegatedLinks,
  fetchLinkEntry,
  getAllLinks,
} from "api/functions/linkry.js";
import { intersection } from "api/plugins/auth.js";

type OwnerRecord = {
  slug: string;
  redirect: string;
  access: string;
  updatedAt: string;
  createdAt: string;
};

type AccessRecord = {
  slug: string;
  access: string;
  createdAt: string;
  updatedAt: string;
};

type LinkyCreateRequest = {
  Params: undefined;
  Querystring: undefined;
  Body: z.infer<typeof createRequest>;
};

type LinkryGetRequest = {
  Params: { slug: string };
  Querystring: undefined;
  Body: undefined;
};

type LinkryDeleteRequest = {
  Params: { slug: string };
  Querystring: undefined;
  Body: undefined;
};

const dynamoClient = new DynamoDBClient({
  region: genericConfig.AwsRegion,
});

const linkryRoutes: FastifyPluginAsync = async (fastify, _options) => {
  const limitedRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.register(rateLimiter, {
      limit: 30,
      duration: 60,
      rateLimitIdentifier: "linkry",
    });

    fastify.get<NoDataRequest>(
      "/redir",
      {
        onRequest: async (request, reply) => {
          await fastify.authorize(request, reply, [
            AppRoles.LINKS_MANAGER,
            AppRoles.LINKS_ADMIN,
          ]);
        },
      },
      async (request, reply) => {
        try {
          const username = request.username!;
          const tableName = genericConfig.LinkryDynamoTableName;
          const ownerRecords = await fetchOwnerRecords(
            username,
            tableName,
            fastify.dynamoClient,
          );
          const ownedUniqueSlugs = extractUniqueSlugs(ownerRecords);
          const ownedLinksWithGroups = await getGroupsForSlugs(
            ownedUniqueSlugs,
            ownerRecords,
            tableName,
            fastify.dynamoClient,
          );
          let delegatedLinks;
          let userGroups: string[];
          if (request.userRoles!.has(AppRoles.LINKS_ADMIN)) {
            delegatedLinks = (
              await getAllLinks(tableName, fastify.dynamoClient)
            ).filter((x) => x.owner !== username);
          } else {
            userGroups = getFilteredUserGroups(request);
            delegatedLinks = await getDelegatedLinks(
              userGroups,
              ownedUniqueSlugs,
              tableName,
              fastify.dynamoClient,
            );
          }
          reply.code(200).send({
            ownedLinks: ownedLinksWithGroups,
            delegatedLinks: delegatedLinks,
          });
        } catch (error) {
          if (error instanceof BaseError) {
            throw error;
          }
          request.log.error(
            `Failed to get from DynamoDB: ${error instanceof Error ? error.toString() : "Unknown error"}`,
          );
          throw new DatabaseFetchError({
            message: "Failed to get Links from Dynamo table.",
          });
        }
      },
    );

    fastify.post<LinkyCreateRequest>(
      "/redir",
      {
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

          await fastify.zodValidateBody(request, reply, createRequest);

          if (!fastify.cloudfrontKvClient) {
            fastify.cloudfrontKvClient = new CloudFrontKeyValueStoreClient({
              region: genericConfig.AwsRegion,
            });
          }
        },
        onRequest: async (request, reply) => {
          await fastify.authorize(request, reply, [
            AppRoles.LINKS_MANAGER,
            AppRoles.LINKS_ADMIN,
          ]);
        },
      },
      async (request, reply) => {
        // Add to cloudfront key value store so that redirects happen at the edge
        const kvArn = await getLinkryKvArn(fastify.runEnvironment);
        let currentRecord = null;
        try {
          await setKey({
            key: request.body.slug,
            value: request.body.redirect,
            kvsClient: fastify.cloudfrontKvClient,
            arn: kvArn,
          });
        } catch (e) {
          fastify.log.error(e);
          if (e instanceof BaseError) {
            throw e;
          }
          throw new DatabaseInsertError({
            message: "Failed to save redirect to Cloudfront KV store.",
          });
        }

        // Use a transaction to handle if one/multiple of these writes fail
        const TransactItems: TransactWriteItem[] = [];

        try {
          const queryOwnerCommand = new QueryCommand({
            TableName: genericConfig.LinkryDynamoTableName,
            KeyConditionExpression:
              "slug = :slug AND begins_with(access, :ownerPrefix)",
            ExpressionAttributeValues: marshall({
              ":slug": request.body.slug,
              ":ownerPrefix": "OWNER#",
            }),
          });

          currentRecord = await dynamoClient.send(queryOwnerCommand);
          const mode =
            currentRecord.Items && currentRecord.Items.length > 0
              ? "modify"
              : "create";
          const currentUpdatedAt =
            currentRecord.Items && currentRecord.Items.length > 0
              ? unmarshall(currentRecord.Items[0]).updatedAt
              : null;
          const currentCreatedAt =
            currentRecord.Items && currentRecord.Items.length > 0
              ? unmarshall(currentRecord.Items[0]).createdAt
              : null;

          // Generate new timestamp for all records
          const creationTime: Date = new Date();
          const newUpdatedAt = creationTime.toISOString();
          const newCreatedAt = currentCreatedAt || newUpdatedAt;
          const queryCommand = new QueryCommand({
            TableName: genericConfig.LinkryDynamoTableName,
            KeyConditionExpression:
              "slug = :slug AND begins_with(access, :accessPrefix)",
            ExpressionAttributeValues: marshall({
              ":slug": request.body.slug,
              ":accessPrefix": "GROUP#",
            }),
          });

          const existingGroups = await dynamoClient.send(queryCommand);
          const existingGroupSet = new Set<string>();
          let existingGroupTimestampMismatch = false;

          if (existingGroups.Items && existingGroups.Items.length > 0) {
            for (const item of existingGroups.Items) {
              const unmarshalledItem = unmarshall(item);
              existingGroupSet.add(unmarshalledItem.access);

              // Check if all existing GROUP records have the same updatedAt timestamp
              // This ensures no other process has modified any part of the record
              if (
                currentUpdatedAt &&
                unmarshalledItem.updatedAt &&
                unmarshalledItem.updatedAt !== currentUpdatedAt
              ) {
                existingGroupTimestampMismatch = true;
              }
            }
          }

          // If timestamp mismatch found, reject the operation
          if (existingGroupTimestampMismatch) {
            throw new ValidationError({
              message:
                "Record was modified by another process. Please try again.",
            });
          }

          const ownerRecord: OwnerRecord = {
            slug: request.body.slug,
            redirect: request.body.redirect,
            access: "OWNER#" + request.username,
            updatedAt: newUpdatedAt,
            createdAt: newCreatedAt,
          };

          // Add the OWNER record with a condition check to ensure it hasn't been modified
          const ownerPutItem: TransactWriteItem = {
            Put: {
              TableName: genericConfig.LinkryDynamoTableName,
              Item: marshall(ownerRecord),
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
            accessGroups.map((group) => "GROUP#" + group),
          );

          // Add new GROUP records that don't already exist
          for (const accessGroup of accessGroups) {
            const groupKey = "GROUP#" + accessGroup;

            // Skip if this group already exists
            if (existingGroupSet.has(groupKey)) {
              // Update existing GROUP record with new updatedAt
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
                    ...(mode === "modify"
                      ? { ":currentUpdatedAt": currentUpdatedAt }
                      : {}),
                  }),
                  ...(mode === "modify"
                    ? {
                        ConditionExpression: "updatedAt = :currentUpdatedAt",
                      }
                    : {}),
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
                  Item: marshall(groupRecord),
                },
              };

              TransactItems.push(groupPutItem);
            }
          }

          // Delete GROUP records that are no longer needed
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

            TransactItems.push(deleteItem);
          }
          console.log(JSON.stringify(TransactItems));
          await dynamoClient.send(
            new TransactWriteItemsCommand({ TransactItems }),
          );
          return reply.status(201).send();
        } catch (e) {
          fastify.log.error(e);

          // Clean up cloudfront KV store on error
          if (currentRecord && currentRecord.Count && currentRecord.Count > 0) {
            if (
              currentRecord.Items &&
              currentRecord.Items.length > 0 &&
              currentRecord.Items[0].redirect.S
            ) {
              fastify.log.info("Reverting CF Key store value due to error");
              await setKey({
                key: request.body.slug,
                value: currentRecord.Items[0].redirect.S,
                kvsClient: fastify.cloudfrontKvClient,
                arn: kvArn,
              });
            } else {
              // it didn't exist before
              fastify.log.info("Deleting CF Key store value due to error");
              await deleteKey({
                key: request.body.slug,
                kvsClient: fastify.cloudfrontKvClient,
                arn: kvArn,
              });
            }
          }
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
      },
    );

    fastify.get<LinkryGetRequest>(
      "/redir/:slug",
      {
        onRequest: async (request, reply) => {
          await fastify.authorize(request, reply, [
            AppRoles.LINKS_MANAGER,
            AppRoles.LINKS_ADMIN,
          ]);
        },
      },
      async (request, reply) => {
        try {
          const { slug } = request.params;
          const tableName = genericConfig.LinkryDynamoTableName;
          // It's likely faster to just fetch and not return if not found
          // Rather than checking each individual group manually
          const item = await fetchLinkEntry(
            slug,
            tableName,
            fastify.dynamoClient,
          );
          if (!item) {
            throw new NotFoundError({ endpointName: request.url });
          }
          if (!request.userRoles!.has(AppRoles.LINKS_ADMIN)) {
            const setUserGroups = new Set(request.tokenPayload?.groups || []);
            const mutualGroups = intersection(
              new Set(item["access"]),
              setUserGroups,
            );
            if (mutualGroups.size == 0) {
              throw new NotFoundError({ endpointName: request.url });
            }
          }
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
      },
    );

    fastify.delete<LinkryDeleteRequest>(
      "/redir/:slug",
      {
        onRequest: async (request, reply) => {
          await fastify.authorize(request, reply, [
            AppRoles.LINKS_MANAGER,
            AppRoles.LINKS_ADMIN,
          ]);

          const { slug: slug } = request.params;
          // Query to get all items with the specified slug
          const queryParams = {
            TableName: genericConfig.LinkryDynamoTableName,
            KeyConditionExpression: "slug = :slug",
            ExpressionAttributeValues: {
              ":slug": { S: decodeURIComponent(slug) },
            },
          };

          const queryCommand = new QueryCommand(queryParams);
          const queryResponse = await dynamoClient.send(queryCommand);

          const items: object[] = queryResponse.Items || [];
          const unmarshalledItems: (OwnerRecord | AccessRecord)[] = [];
          for (const item of items) {
            unmarshalledItems.push(
              unmarshall(item as { [key: string]: AttributeValue }) as
                | OwnerRecord
                | AccessRecord,
            );
          }
          if (items.length == 0)
            throw new ValidationError({ message: "Slug does not exist" });

          const ownerRecord: OwnerRecord = unmarshalledItems.filter(
            (item): item is OwnerRecord => "redirect" in item,
          )[0];

          const accessGroupNames: string[] = [];
          for (const record of unmarshalledItems) {
            if (record && record != ownerRecord) {
              const accessGroupUUID: string = record.access.split("GROUP#")[1];
              accessGroupNames.push(accessGroupUUID);
            }
          }

          if (!request.username) {
            throw new Error("Username is undefined");
          }

          // const allUserGroupUUIDs = await listGroupIDsByEmail(
          //   entraIdToken,
          //   request.username,
          // );

          const allUserGroupUUIDs = request.tokenPayload?.groups ?? [];

          const userLinkryGroups = allUserGroupUUIDs.filter((groupId) =>
            [...LinkryGroupUUIDToGroupNameMap.keys()].includes(groupId),
          );

          if (
            (ownerRecord &&
              ownerRecord.access.split("OWNER#")[1] == request.username) ||
            userLinkryGroups.length > 0
          ) {
          } else {
            throw new UnauthorizedError({
              message: "User does not have permission to delete slug.",
            });
          }
          if (!fastify.cloudfrontKvClient) {
            fastify.cloudfrontKvClient = new CloudFrontKeyValueStoreClient({
              region: genericConfig.AwsRegion,
            });
          }
        },
      },
      async (request, reply) => {
        const { slug: slug } = request.params;

        // Delete from Cloudfront KV first
        const kvArn = await getLinkryKvArn(fastify.runEnvironment);
        try {
          await deleteKey({
            key: slug,
            kvsClient: fastify.cloudfrontKvClient,
            arn: kvArn,
          });
        } catch (e) {
          fastify.log.error(e);
          if (e instanceof BaseError) {
            throw e;
          }
          throw new DatabaseInsertError({
            message: "Failed to delete redirect at Cloudfront KV store.",
          });
        }
        // Query to get all items with the specified slug
        const queryParams = {
          TableName: genericConfig.LinkryDynamoTableName, // Replace with your table name
          KeyConditionExpression: "slug = :slug",
          ExpressionAttributeValues: {
            ":slug": { S: decodeURIComponent(slug) },
          },
        };

        const queryCommand = new QueryCommand(queryParams);
        const queryResponse = await dynamoClient.send(queryCommand);

        const items = queryResponse.Items || [];

        const filteredItems = items.filter((item) => {
          if (item.access.S?.startsWith("OWNER#")) {
            return true;
          } // TODO Ethan: temporary solution, current filter deletes all owner tagged and group tagged, need to differentiate between deleting owner versus deleting specific groups...
          else {
            return (
              item.access.S &&
              [...LinkryGroupUUIDToGroupNameMap.keys()].includes(
                item.access.S.replace("GROUP#", ""),
              )
            );
          }
        });

        // Delete all fetched items
        const deletePromises = (filteredItems || []).map((item) =>
          dynamoClient.send(
            new DeleteItemCommand({
              TableName: genericConfig.LinkryDynamoTableName,
              Key: { slug: item.slug, access: item.access },
            }),
          ),
        );
        try {
          await Promise.all(deletePromises); // TODO: use TransactWriteItems, it can also do deletions
        } catch (e) {
          // TODO: revert Cloudfront KV store here
          fastify.log.error(e);
          if (e instanceof BaseError) {
            throw e;
          }
          throw new DatabaseDeleteError({
            message: "Failed to delete record in DynamoDB.",
          });
        }

        reply.code(200).send({
          message: `All records with slug '${slug}' deleted successfully`,
        });
      },
    );
  };
  fastify.register(limitedRoutes);
};

export default linkryRoutes;
