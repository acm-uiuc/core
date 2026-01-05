import { FastifyPluginAsync } from "fastify";
import rateLimiter from "api/plugins/rateLimiter.js";
import { withRoles, withTags } from "api/components/index.js";
import {
  QueryCommand,
  UpdateItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";
import {
  DatabaseFetchError,
  DatabaseInsertError,
  ValidationError,
} from "common/errors/index.js";
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
    "/:orgId/event/:eventId",
    {
      schema: withTags(["RSVP"], {
        summary: "Submit an RSVP for an event.",
        params: z.object({
          eventId: z.string().min(1).meta({
            description: "The previously-created event ID in the events API.",
          }),
          orgId: z.string().min(1).meta({
            description: "The organization ID the event belongs to.",
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
                schema: z.object({
                  partitionKey: z.string(),
                  eventId: z.string(),
                  userId: z.string(),
                  isPaidMember: z.boolean(),
                  createdAt: z.string(),
                }),
              },
            },
          },
          409: {
            description: "User has already RSVP'd for this event.",
            content: {
              "application/json": {
                schema: z.object({
                  message: z.string(),
                }),
              },
            },
          },
        },
      }),
    },
    async (request, reply) => {
      const accessToken = request.headers["x-uiuc-token"];
      const verifiedData = await verifyUiucAccessToken({
        accessToken,
        logger: request.log,
      });
      const { userPrincipalName: upn, givenName, surname } = verifiedData;
      const netId = upn.replace("@illinois.edu", "");
      if (netId.includes("@")) {
        request.log.error(
          `Found UPN ${upn} which cannot be turned into NetID via simple replacement.`,
        );
        throw new ValidationError({
          message: "ID token could not be parsed.",
        });
      }
      const isPaidMember = await checkPaidMembership({
        netId,
        dynamoClient: fastify.dynamoClient,
        redisClient: fastify.redisClient,
        logger: request.log,
      });
      const entry = {
        partitionKey: `${request.params.eventId}#${upn}`,
        eventId: request.params.eventId,
        userId: upn,
        isPaidMember,
        createdAt: "",
      };
      const transactionCommand = new TransactWriteItemsCommand({
        TransactItems: [
          {
            Put: {
              TableName: genericConfig.RSVPDynamoTableName,
              Item: marshall(entry),
              ConditionExpression: "attribute_not_exists(partitionKey)",
            },
          },
          {
            Update: {
              TableName: genericConfig.EventsDynamoTableName,
              Key: marshall({ id: request.params.eventId }),
              UpdateExpression: "SET rsvpCount = if_not_exists(rsvpCount, :start) + :inc",
              ConditionExpression:
                "rsvpCount < rsvpLimit OR attribute_not_exists(rsvpLimit)",
              ExpressionAttributeValues: marshall({
                ":inc": 1,
                ":start": 0,
              }),
            },
          },
        ],
      });

      try {
        await fastify.dynamoClient.send(transactionCommand);
        return reply.status(201).send(entry);
      } catch (err: any) {
        if (err.name === "TransactionCanceledException") {
          if (err.CancellationReasons[0].Code === "ConditionalCheckFailed") {
            return reply.status(409).send({
              message: "You have already RSVP'd for this event.",
            });
          }
          if (err.CancellationReasons[1].Code === "ConditionalCheckFailed") {
             return reply.status(409).send({
               message: "The event is at capacity.",
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
    "/:orgId/event/:eventId",
    {
      schema: withRoles(
        [AppRoles.VIEW_RSVPS],
        withTags(["RSVP"], {
          summary: "Get all RSVPs for an event.",
          params: z.object({
            eventId: z.string().min(1).meta({
              description: "The previously-created event ID in the events API.",
            }),
            orgId: z.string().min(1).meta({
              description: "The organization ID the event belongs to.",
            }),
          }),
          response: {
            200: {
              description: "List of RSVPs.",
              content: {
                "application/json": {
                  schema: z.array(
                    z.object({
                      partitionKey: z.string(),
                      eventId: z.string(),
                      userId: z.string(),
                      isPaidMember: z.boolean(),
                      createdAt: z.string(),
                    }),
                  ),
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
        throw new DatabaseFetchError({
          message: "Failed to get all member lists.",
        });
      }
      const rsvps = response.Items.map((x) => unmarshall(x));
      const uniqueRsvps = [
        ...new Map(rsvps.map((item) => [item.userId, item])).values(),
      ];
      return reply.send(uniqueRsvps);
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/:orgId/event/:eventId/config",
    {
      schema: withRoles(
        [AppRoles.RSVPS_MANAGER, AppRoles.EVENTS_MANAGER],
        withTags(["RSVP"], {
          summary: "Configure RSVP settings for an event.",
          params: z.object({
            eventId: z.string().min(1).meta({
              description: "The event ID to configure.",
            }),
            orgId: z.string().min(1).meta({
              description: "The organization ID the event belongs to.",
            }),
          }),
          body: z.object({
            rsvpLimit: z.number().int().min(1).nullable().meta({
              description:
                "The maximum number of attendees allowed. Set to null for unlimited.",
            }),
          }),
          response: {
            200: {
              description: "Configuration updated successfully.",
              content: {
                "application/json": {
                  schema: z.object({
                    rsvpLimit: z.number().int().nullable(),
                  }),
                },
              },
            },
            404: {
              description: "Event not found.",
              content: {
                "application/json": {
                  schema: z.object({
                    statusCode: z.number(),
                    error: z.string(),
                    message: z.string(),
                  }),
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      const { rsvpLimit } = request.body;
      const { eventId } = request.params;
      const isRemovingLimit = rsvpLimit === null;
      const command = new UpdateItemCommand({
        TableName: genericConfig.EventsDynamoTableName,
        Key: marshall({ id: eventId }),
        UpdateExpression: isRemovingLimit
          ? "REMOVE rsvpLimit"
          : "SET rsvpLimit = :limit",
        ExpressionAttributeValues: isRemovingLimit
          ? undefined
          : marshall({
              ":limit": rsvpLimit,
              ":zero": 0,
            }),
        ConditionExpression: "attribute_exists(id)",
        ReturnValues: "UPDATED_NEW",
      });

      try {
        await fastify.dynamoClient.send(command);
        return reply.status(200).send({ rsvpLimit });
      } catch (err: any) {
        if (err.name === "ConditionalCheckFailedException") {
          return reply.status(404).send({
            statusCode: 404,
            error: "Not Found",
            message: "The specified event does not exist.",
          });
        }

        request.log.error(err, "Failed to update event config");
        throw new DatabaseInsertError({
          message: "Failed to update event configuration.",
        });
      }
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().delete(
    "/:orgId/event/:eventId/:userId",
    {
      schema: withRoles(
        [AppRoles.RSVPS_MANAGER],
        withTags(["RSVP"], {
          summary: "Delete an RSVP for an event.",
          params: z.object({
            eventId: z.string().min(1).meta({
              description: "The previously-created event ID in the events API.",
            }),
            userId: z.string().min(1).meta({
              description: "The user ID of the RSVP to delete.",
            }),
            orgId: z.string().min(1).meta({
              description: "The organization ID the event belongs to.",
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
            404: {
              description: "RSVP not found.",
              content: {
                "application/json": {
                  schema: z.object({
                    error: z.string(),
                    message: z.string(),
                  }),
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      const rsvpPartitionKey = `${request.params.eventId}#${request.params.userId}`;

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
              TableName: genericConfig.EventsDynamoTableName,
              Key: marshall({ id: request.params.eventId }),
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
        return reply.status(204).send();
      } catch (err: any) {
        if (err.name === "TransactionCanceledException") {
          if (err.CancellationReasons[0].Code === "ConditionalCheckFailed") {
            return reply.status(404).send({
              error: "Not Found",
              message: "This user does not have an active RSVP for this event.",
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
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().delete(
    "/:orgId/event/:eventId",
    {
      schema: withTags(["RSVP"], {
        summary: "Withdraw your RSVP for an event.",
        params: z.object({
          eventId: z.string().min(1).meta({
            description: "The event ID to withdraw from.",
          }),
          orgId: z.string().min(1).meta({
            description: "The organization ID the event belongs to.",
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
      const verifiedData = await verifyUiucAccessToken({
        accessToken,
        logger: request.log,
      });
      const { userPrincipalName: upn } = verifiedData;
      const netId = upn.replace("@illinois.edu", "");
      if (netId.includes("@")) {
        throw new ValidationError({
          message: "ID token could not be parsed.",
        });
      }
      const transactionCommand = new TransactWriteItemsCommand({
        TransactItems: [
          {
            Delete: {
              TableName: genericConfig.RSVPDynamoTableName,
              Key: marshall({
                partitionKey: `${request.params.eventId}#${upn}`,
              }),
              ConditionExpression: "attribute_exists(partitionKey)",
            },
          },
          {
            Update: {
              TableName: genericConfig.EventsDynamoTableName,
              Key: marshall({ id: request.params.eventId }),
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
        return reply.status(204).send();
      } catch (err: any) {
        if (err.name === "TransactionCanceledException") {
          if (err.CancellationReasons[0].Code === "ConditionalCheckFailed") {
            return reply.status(204).send();
          }
        }

        request.log.error(err, "Failed to withdraw RSVP");
        throw new DatabaseInsertError({
          message: "Failed to withdraw RSVP.",
        });
      }
    },
  );
};

export default rsvpRoutes;
