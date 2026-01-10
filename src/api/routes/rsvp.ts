import { FastifyPluginAsync } from "fastify";
import rateLimiter from "api/plugins/rateLimiter.js";
import {
  resourceConflictError,
  withRoles,
  withTags,
} from "api/components/index.js";
import {
  QueryCommand,
  TransactWriteItemsCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";
import {
  DatabaseFetchError,
  DatabaseInsertError,
  ResourceConflictError,
  NotFoundError,
} from "common/errors/index.js";
import { rsvpConfigSchema, rsvpItemSchema } from "common/types/rsvp.js";
import * as z from "zod/v4";
import { verifyUiucAccessToken } from "api/functions/uin.js";
import { checkPaidMembership } from "api/functions/membership.js";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import { genericConfig } from "common/config.js";
import { AppRoles } from "common/roles.js";

const rsvpRoutes: FastifyPluginAsync = async (fastify, _options) => {
  await fastify.register(rateLimiter, {
    limit: 30,
    duration: 30,
    rateLimitIdentifier: "rsvp",
  });
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/event/:eventId",
    {
      schema: withTags(["RSVP"], {
        summary: "Submit an RSVP for an event.",
        params: z.object({
          eventId: z.string().min(1).meta({
            description: "The previously-created event ID in the events API.",
          }),
        }),
        headers: z.object({
          "x-uiuc-token": z.jwt().min(1).meta({
            description:
              "An access token for the user in the UIUC Entra ID tenant.",
          }),
        }),
        response: {
          201: {
            description: "RSVP created successfully.",
            content: {
              "application/json": {
                schema: z.null(),
              },
            },
          },
          409: resourceConflictError,
        },
      }),
    },
    async (request, reply) => {
      const { eventId } = request.params;

      const accessToken = request.headers["x-uiuc-token"];
      const { netId, userPrincipalName: upn } = await verifyUiucAccessToken({
        accessToken,
        logger: request.log,
      });

      const isPaidMember = await checkPaidMembership({
        netId,
        dynamoClient: fastify.dynamoClient,
        redisClient: fastify.redisClient,
        logger: request.log,
      });

      const configKey = { partitionKey: `CONFIG#${eventId}` };

      let configItem;
      try {
        const configResponse = await fastify.dynamoClient.send(
          new GetItemCommand({
            TableName: genericConfig.RSVPDynamoTableName,
            Key: marshall(configKey),
          }),
        );
        configItem = configResponse.Item
          ? unmarshall(configResponse.Item)
          : null;
      } catch (err: any) {
        throw new DatabaseFetchError({
          message: "Failed to fetch event configuration.",
        });
      }
      if (!configItem) {
        throw new NotFoundError({
          endpointName: request.url,
        });
      }
      const now = Date.now();
      if (configItem.rsvpOpenAt && now < configItem.rsvpOpenAt) {
        throw new ResourceConflictError({
          message: "RSVPs are not yet open for this event.",
        });
      }
      if (configItem.rsvpCloseAt && now > configItem.rsvpCloseAt) {
        throw new ResourceConflictError({
          message: "RSVPs have closed for this event.",
        });
      }
      const rsvpEntry = {
        partitionKey: `RSVP#${eventId}#${upn}`,
        eventId,
        userId: upn,
        isPaidMember,
        createdAt: now,
      };

      const transactionCommand = new TransactWriteItemsCommand({
        TransactItems: [
          {
            Put: {
              TableName: genericConfig.RSVPDynamoTableName,
              Item: marshall(rsvpEntry),
              ConditionExpression: "attribute_not_exists(partitionKey)",
            },
          },
          {
            Update: {
              TableName: genericConfig.RSVPDynamoTableName,
              Key: marshall(configKey),
              UpdateExpression: "SET rsvpCount = rsvpCount + :inc",
              ConditionExpression:
                "attribute_exists(partitionKey) AND (rsvpLimit = :null OR rsvpCount < rsvpLimit)",
              ExpressionAttributeValues: marshall({
                ":inc": 1,
                ":start": 0,
                ":null": null,
              }),
            },
          },
        ],
      });

      try {
        await fastify.dynamoClient.send(transactionCommand);
        return reply.status(201).send(null);
      } catch (err: any) {
        if (err.name === "TransactionCanceledException") {
          if (err.CancellationReasons[0].Code === "ConditionalCheckFailed") {
            throw new ResourceConflictError({
              message:
                "This user has already submitted an RSVP for this event.",
            });
          }
          if (err.CancellationReasons[1].Code === "ConditionalCheckFailed") {
            throw new ResourceConflictError({
              message: "RSVP limit has been reached for this event.",
            });
          }
        }
        request.log.error(err, "Failed to process RSVP transaction");
        throw new DatabaseInsertError({
          message: "Failed to submit RSVP.",
        });
      }
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/event/:eventId",
    {
      schema: withRoles(
        [AppRoles.RSVP_VIEWER],
        withTags(["RSVP"], {
          summary: "Get all RSVPs for an event.",
          params: z.object({
            eventId: z.string().min(1).meta({
              description: "The previously-created event ID in the events API.",
            }),
          }),
          response: {
            200: {
              description: "List of RSVPs.",
              content: {
                "application/json": {
                  schema: z.array(rsvpItemSchema),
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      const command = new QueryCommand({
        TableName: genericConfig.RSVPDynamoTableName,
        IndexName: "EventIdIndex",
        KeyConditionExpression: "eventId = :eid",
        ExpressionAttributeValues: {
          ":eid": { S: request.params.eventId },
        },
      });
      const response = await fastify.dynamoClient.send(command);
      if (!response || !response.Items) {
        return reply.send([]);
      }
      const rawItems = response.Items.map((x) => unmarshall(x));
      const rsvpItems = rawItems.filter(
        (item) => item.partitionKey && item.partitionKey.startsWith("RSVP#"),
      );
      const sanitizedRsvps = rsvpItems.map(
        ({ eventId, userId, isPaidMember, createdAt }) => ({
          eventId,
          userId,
          isPaidMember,
          createdAt,
        }),
      );

      const uniqueRsvps = [
        ...new Map(sanitizedRsvps.map((item) => [item.userId, item])).values(),
      ];
      return reply.send(uniqueRsvps);
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/event/:eventId/config",
    {
      schema: withRoles(
        [AppRoles.RSVP_MANAGER],
        withTags(["RSVP"], {
          summary: "Configure RSVP settings for an event.",
          params: z.object({
            eventId: z.string().min(1).meta({
              description: "The event ID to configure.",
            }),
          }),
          body: rsvpConfigSchema,
          response: {
            200: {
              description: "Configuration updated successfully.",
              content: {
                "application/json": {
                  schema: z.null(),
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      const configData = request.body;
      const { eventId } = request.params;
      const partitionKey = `CONFIG#${eventId}`;

      const command = new TransactWriteItemsCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: genericConfig.EventsDynamoTableName,
              Key: marshall({ id: eventId }),
              ConditionExpression: "attribute_exists(id)",
            },
          },
          {
            Update: {
              TableName: genericConfig.RSVPDynamoTableName,
              Key: marshall({ partitionKey }),
              UpdateExpression:
                "SET rsvpLimit = :limit, rsvpCheckInEnabled = :checkIn, rsvpQuestions = :questions, rsvpOpenAt = :openAt, rsvpCloseAt = :closeAt, updatedAt = :now, rsvpCount = if_not_exists(rsvpCount, :zero), eventId = :eid",
              ExpressionAttributeValues: marshall({
                ":limit": configData.rsvpLimit ?? null,
                ":checkIn": configData.rsvpCheckInEnabled,
                ":questions": configData.rsvpQuestions,
                ":openAt": configData.rsvpOpenAt,
                ":closeAt": configData.rsvpCloseAt,
                ":now": Date.now(),
                ":zero": 0,
                ":eid": eventId,
              }),
            },
          },
        ],
      });

      try {
        await fastify.dynamoClient.send(command);
        return reply.status(200).send(null);
      } catch (err: any) {
        if (err.name === "TransactionCanceledException") {
          if (err.CancellationReasons[0].Code === "ConditionalCheckFailed") {
            throw new NotFoundError({
              endpointName: request.url,
            });
          }
        }

        request.log.error(err, "Failed to update event config");
        throw new DatabaseInsertError({
          message: "Failed to update event configuration.",
        });
      }
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/me",
    {
      schema: withTags(["RSVP"], {
        summary: "Get your RSVPs across all events.",
        headers: z.object({
          "x-uiuc-token": z.jwt().min(1).meta({
            description:
              "An access token for the user in the UIUC Entra ID tenant.",
          }),
        }),
        response: {
          200: {
            description: "List of your RSVPs.",
            content: {
              "application/json": {
                schema: z.array(rsvpItemSchema),
              },
            },
          },
        },
      }),
    },
    async (request, reply) => {
      const accessToken = request.headers["x-uiuc-token"];
      const { userPrincipalName: upn } = await verifyUiucAccessToken({
        accessToken,
        logger: request.log,
      });

      const command = new QueryCommand({
        TableName: genericConfig.RSVPDynamoTableName,
        IndexName: "UserIdIndex",
        KeyConditionExpression: "userId = :uid",
        ExpressionAttributeValues: {
          ":uid": { S: upn },
        },
      });
      const response = await fastify.dynamoClient.send(command);
      if (!response || !response.Items) {
        return reply.send([]);
      }
      const rawItems = response.Items.map((x) => unmarshall(x));
      const rsvpItems = rawItems.filter(
        (item) => item.partitionKey && item.partitionKey.startsWith("RSVP#"),
      );
      const sanitizedRsvps = rsvpItems.map(
        ({ eventId, userId, isPaidMember, createdAt }) => ({
          eventId,
          userId,
          isPaidMember,
          createdAt,
        }),
      );

      const uniqueRsvps = [
        ...new Map(sanitizedRsvps.map((item) => [item.eventId, item])).values(),
      ];
      return reply.send(uniqueRsvps);
    },
  );
  // This route MUST be registered first so it is handled correctly
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().delete(
    "/event/:eventId/attendee/me",
    {
      schema: withTags(["RSVP"], {
        summary: "Withdraw your RSVP for an event.",
        params: z.object({
          eventId: z.string().min(1).meta({
            description: "The event ID to withdraw from.",
          }),
        }),
        headers: z.object({
          "x-uiuc-token": z.jwt().min(1).meta({
            description:
              "An access token for the user in the UIUC Entra ID tenant.",
          }),
        }),
        response: {
          204: {
            description: "RSVP withdrawn successfully.",
            content: {
              "application/json": {
                schema: z.null(),
              },
            },
          },
        },
      }),
    },
    async (request, reply) => {
      const accessToken = request.headers["x-uiuc-token"];
      const { userPrincipalName: upn } = await verifyUiucAccessToken({
        accessToken,
        logger: request.log,
      });
      const rsvpPartitionKey = `RSVP#${request.params.eventId}#${upn}`;
      const rsvpConfigKey = `CONFIG#${request.params.eventId}`;
      const transactionCommand = new TransactWriteItemsCommand({
        TransactItems: [
          {
            Delete: {
              TableName: genericConfig.RSVPDynamoTableName,
              Key: marshall({
                partitionKey: rsvpPartitionKey,
              }),
              ConditionExpression: "attribute_exists(partitionKey)",
            },
          },
          {
            Update: {
              TableName: genericConfig.RSVPDynamoTableName,
              Key: marshall({
                partitionKey: rsvpConfigKey,
              }),
              UpdateExpression: "SET rsvpCount = rsvpCount - :dec",
              ConditionExpression: "rsvpCount > :zero",
              ExpressionAttributeValues: marshall({
                ":dec": 1,
                ":zero": 0,
              }),
            },
          },
        ],
      });

      try {
        await fastify.dynamoClient.send(transactionCommand);
        return reply.status(204).send(null);
      } catch (err: any) {
        if (err.name === "TransactionCanceledException") {
          if (err.CancellationReasons[0].Code === "ConditionalCheckFailed") {
            return reply.status(204).send(null);
          }
        }

        request.log.error(err, "Failed to withdraw RSVP");
        throw new DatabaseInsertError({
          message: "Failed to withdraw RSVP.",
        });
      }
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().delete(
    "/event/:eventId/attendee/:userId",
    {
      schema: withRoles(
        [AppRoles.RSVP_MANAGER],
        withTags(["RSVP"], {
          summary: "Delete an RSVP for an event.",
          params: z.object({
            eventId: z.string().min(1).meta({
              description: "The previously-created event ID in the events API.",
            }),
            userId: z.string().min(1).meta({
              description: "The user ID of the RSVP to delete.",
            }),
          }),
          response: {
            204: {
              description: "RSVP deleted successfully.",
              content: {
                "application/json": {
                  schema: z.null(),
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      const rsvpPartitionKey = `RSVP#${request.params.eventId}#${request.params.userId}`;
      const rsvpConfigKey = `CONFIG#${request.params.eventId}`;

      const transactionCommand = new TransactWriteItemsCommand({
        TransactItems: [
          {
            Delete: {
              TableName: genericConfig.RSVPDynamoTableName,
              Key: marshall({ partitionKey: rsvpPartitionKey }),
              ConditionExpression: "attribute_exists(partitionKey)",
            },
          },
          {
            Update: {
              TableName: genericConfig.RSVPDynamoTableName,
              Key: marshall({
                partitionKey: rsvpConfigKey,
              }),
              UpdateExpression: "SET rsvpCount = rsvpCount - :dec",
              ConditionExpression: "rsvpCount > :zero",
              ExpressionAttributeValues: marshall({
                ":dec": 1,
                ":zero": 0,
              }),
            },
          },
        ],
      });

      try {
        await fastify.dynamoClient.send(transactionCommand);
        return reply.status(204).send(null);
      } catch (err: any) {
        if (err.name === "TransactionCanceledException") {
          if (err.CancellationReasons[0].Code === "ConditionalCheckFailed") {
            throw new NotFoundError({
              endpointName: request.url,
            });
          }
        }

        request.log.error(err, "Failed to delete RSVP as manager");
        throw new DatabaseInsertError({
          message: "Failed to remove RSVP.",
        });
      }
    },
  );
};

export default rsvpRoutes;
