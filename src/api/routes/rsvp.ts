import { FastifyPluginAsync } from "fastify";
import rateLimiter from "api/plugins/rateLimiter.js";
import {
  resourceConflictError,
  withRoles,
  withTags,
  withTurnstile,
} from "api/components/index.js";
import {
  QueryCommand,
  TransactWriteItemsCommand,
  GetItemCommand,
  UpdateItemCommand,
  PutItemCommand,
  DeleteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";
import {
  DatabaseFetchError,
  DatabaseInsertError,
  ResourceConflictError,
  NotFoundError,
  ValidationError,
  DatabaseDeleteError,
} from "common/errors/index.js";
import {
  rsvpConfigSchema,
  rsvpItemSchema,
  majorSchema,
  rsvpProfileSchema,
} from "common/types/rsvp.js";
import * as z from "zod/v4";
import { verifyUiucAccessToken } from "api/functions/uin.js";
import { checkPaidMembership } from "api/functions/membership.js";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import { genericConfig } from "common/config.js";
import { AppRoles } from "common/roles.js";
import { request } from "node:http";

const rsvpRoutes: FastifyPluginAsync = async (fastify, _options) => {
  await fastify.register(rateLimiter, {
    limit: 30,
    duration: 30,
    rateLimitIdentifier: "rsvp",
  });
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/profile",
    {
      schema: withTurnstile(
        {},
        withTags(["RSVP"], {
          summary: "Create an RSVP profile for events",
          body: z.object({
            schoolYear: z
              .enum(["Freshman", "Sophomore", "Junior", "Senior", "Graduate"])
              .meta({
                description:
                  "The school year associated with the user's profile.",
              }),
            intendedMajor: majorSchema,
            interests: z.array(z.string()).meta({
              description: "The interests associated with the user's profile",
            }),
            dietaryRestrictions: z.array(z.string()).meta({
              description: "User's dietary restrictions.",
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
              description: "RSVP Profile updated successfully.",
              content: {
                "application/json": {
                  schema: z.null(),
                },
              },
            },
          },
        }),
      ),
    },
    async (request, reply) => {
      const accessToken = request.headers["x-uiuc-token"];
      const { userPrincipalName: upn } = await verifyUiucAccessToken({
        accessToken,
        logger: request.log,
      });

      const { schoolYear, intendedMajor, interests, dietaryRestrictions } =
        request.body;

      const now = Math.floor(Date.now() / 1000);

      const profileItem = {
        partitionKey: `PROFILE#${upn}`,
        schoolYear,
        intendedMajor,
        interests,
        dietaryRestrictions,
        updatedAt: now,
      };

      try {
        await fastify.dynamoClient.send(
          new PutItemCommand({
            TableName: genericConfig.RSVPDynamoTableName,
            Item: marshall(profileItem),
          }),
        );
        return reply.status(201).send();
      } catch (err: any) {
        request.log.error(err, "Failed to update user profile");
        throw new DatabaseInsertError({
          message: "Failed to update profile.",
        });
      }
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/profile/me",
    {
      schema: withTags(["RSVP"], {
        summary: "Get current user's RSVP profile",
        headers: z.object({
          "x-uiuc-token": z.string().min(1).meta({
            description:
              "An access token for the user in the UIUC Entra ID tenant.",
          }),
        }),
        response: {
          200: {
            description: "The user's profile data.",
            content: {
              "application/json": {
                schema: rsvpProfileSchema,
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

      const key = { partitionKey: `PROFILE#${upn}` };

      let profileItem;
      try {
        const response = await fastify.dynamoClient.send(
          new GetItemCommand({
            TableName: genericConfig.RSVPDynamoTableName,
            Key: marshall(key),
          }),
        );
        if (!response || !response.Item) {
          throw new NotFoundError({
            endpointName: request.url,
          });
        }
        profileItem = unmarshall(response.Item);
      } catch (err) {
        if (err instanceof NotFoundError) {
          throw err;
        }
        throw new DatabaseFetchError({
          message: "Could not retrieve profile.",
        });
      }

      return reply.status(200).send(profileItem);
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().delete(
    "/profile/me",
    {
      schema: withTags(["RSVP"], {
        summary: "Delete current user's RSVP profile",
        headers: z.object({
          "x-uiuc-token": z.string().min(1).meta({
            description:
              "An access token for the user in the UIUC Entra ID tenant.",
          }),
        }),
        response: {
          200: {
            description: "Profile successfully deleted!",
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

      const key = { partitionKey: `PROFILE#${upn}` };

      try {
        await fastify.dynamoClient.send(
          new DeleteItemCommand({
            TableName: genericConfig.RSVPDynamoTableName,
            Key: marshall(key),
          }),
        );
      } catch (err) {
        throw new DatabaseDeleteError({ message: "Could not delete profile." });
      }
      return reply.status(200).send();
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/event/:eventId",
    {
      schema: withTurnstile(
        {},
        withTags(["RSVP"], {
          summary: "Submit an RSVP for an event",
          description:
            "Requires the user to have a Profile created first. Snapshots profile data upon RSVP.",
          params: z.object({
            eventId: z.string().min(1).meta({ description: "The Event ID." }),
          }),
          headers: z.object({
            "x-uiuc-token": z
              .string()
              .min(1)
              .meta({ description: "UIUC Entra ID Token." }),
          }),
          response: {
            201: {
              description: "RSVP created successfully.",
              content: { "application/json": { schema: z.null() } },
            },
            400: {
              description: "Missing Profile",
              content: {
                "application/json": {
                  schema: z.object({ message: z.string() }),
                },
              },
            },
            409: resourceConflictError,
          },
        }),
      ),
    },
    async (request, reply) => {
      const { eventId } = request.params;

      const accessToken = request.headers["x-uiuc-token"];
      const { netId, userPrincipalName: upn } = await verifyUiucAccessToken({
        accessToken,
        logger: request.log,
      });

      const configKey = { partitionKey: `CONFIG#${eventId}` };
      const profileKey = { partitionKey: `PROFILE#${upn}` };

      const [configResponse, profileResponse] = await Promise.all([
        fastify.dynamoClient.send(
          new GetItemCommand({
            TableName: genericConfig.RSVPDynamoTableName,
            Key: marshall(configKey),
          }),
        ),
        fastify.dynamoClient.send(
          new GetItemCommand({
            TableName: genericConfig.RSVPDynamoTableName,
            Key: marshall(profileKey),
          }),
        ),
      ]);

      const configItem = configResponse.Item
        ? unmarshall(configResponse.Item)
        : null;
      const profileItem = profileResponse.Item
        ? unmarshall(profileResponse.Item)
        : null;

      if (!configItem) {
        throw new NotFoundError({ endpointName: request.url });
      }

      if (!profileItem) {
        return reply.status(400).send({
          message: "Profile Required",
        });
      }

      const now = Math.floor(Date.now() / 1000);
      if (configItem.rsvpOpenAt && now < configItem.rsvpOpenAt) {
        // 400 error
        throw new ValidationError({
          message: "RSVPs are not yet open for this event.",
        });
      }
      if (configItem.rsvpCloseAt && now > configItem.rsvpCloseAt) {
        throw new ValidationError({
          message: "RSVPs are closed for this event.",
        });
      }

      const isPaidMember = await checkPaidMembership({
        netId,
        dynamoClient: fastify.dynamoClient,
        redisClient: fastify.redisClient,
        logger: request.log,
      });

      const rsvpEntry = {
        partitionKey: `RSVP#${eventId}#${upn}`,
        eventId,
        userId: upn,
        isPaidMember,
        createdAt: now,
        schoolYear: profileItem.schoolYear,
        intendedMajor: profileItem.intendedMajor,
        interests: profileItem.interests || [],
        dietaryRestrictions: profileItem.dietaryRestrictions || [],
        checkedIn: false,
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
              ExpressionAttributeValues: marshall({ ":inc": 1, ":null": null }),
            },
          },
        ],
      });

      try {
        await fastify.dynamoClient.send(transactionCommand);
        return reply.status(201).send();
      } catch (err: any) {
        if (err.name === "TransactionCanceledException") {
          if (err.CancellationReasons[0].Code === "ConditionalCheckFailed") {
            // 409
            throw new ResourceConflictError({
              message: "You have already RSVP'd for this event.",
            });
          }
          if (err.CancellationReasons[1].Code === "ConditionalCheckFailed") {
            throw new ResourceConflictError({
              message: "RSVP limit has been reached.",
            });
          }
        }
        request.log.error(err, "Failed to process RSVP transaction");
        //500
        throw new DatabaseInsertError({ message: "Failed to submit RSVP." });
      }
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/event/:eventId",
    {
      schema: withRoles(
        [AppRoles.RSVP_MANAGER],
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
        ({
          eventId,
          userId,
          isPaidMember,
          dietaryRestrictions,
          intendedMajor,
          schoolYear,
          interests,
          checkedIn,
          createdAt,
        }) => ({
          eventId,
          userId,
          isPaidMember,
          dietaryRestrictions,
          intendedMajor,
          schoolYear,
          interests,
          checkedIn,
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
                "SET rsvpLimit = :limit, rsvpCheckInEnabled = :checkIn, rsvpOpenAt = :openAt, rsvpCloseAt = :closeAt, updatedAt = :now, rsvpCount = if_not_exists(rsvpCount, :zero), eventId = :eid",
              ExpressionAttributeValues: marshall({
                ":limit": configData.rsvpLimit ?? null,
                ":checkIn": configData.rsvpCheckInEnabled,
                ":openAt": configData.rsvpOpenAt,
                ":closeAt": configData.rsvpCloseAt,
                ":now": Math.floor(Date.now() / 1000),
                ":zero": 0,
                ":eid": eventId,
              }),
            },
          },
        ],
      });

      try {
        await fastify.dynamoClient.send(command);
        return reply.status(200).send();
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
    "/event/:eventId/config",
    {
      schema: withRoles(
        [AppRoles.RSVP_MANAGER],
        withTags(["RSVP"], {
          summary: "Get RSVP configuration for an event.",
          params: z.object({
            eventId: z.string().min(1).meta({
              description: "The event ID to fetch configuration for.",
            }),
          }),
          response: {
            200: {
              description: "RSVP configuration for the event.",
              content: {
                "application/json": {
                  schema: rsvpConfigSchema,
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      const { eventId } = request.params;
      const command = new GetItemCommand({
        TableName: genericConfig.RSVPDynamoTableName,
        Key: marshall({ partitionKey: `CONFIG#${eventId}` }),
      });

      try {
        const response = await fastify.dynamoClient.send(command);
        if (!response || !response.Item) {
          throw new NotFoundError({
            endpointName: request.url,
          });
        }
        const configItem = unmarshall(response.Item);
        return reply.send(configItem);
      } catch (err: any) {
        if (err.name === "ResourceNotFoundException") {
          throw new NotFoundError({
            endpointName: request.url,
          });
        }
        request.log.error(err, "Failed to fetch event config");
        throw new DatabaseFetchError({
          message: "Failed to fetch event configuration.",
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
        ({
          eventId,
          userId,
          isPaidMember,
          dietaryRestrictions,
          intendedMajor,
          schoolYear,
          interests,
          checkedIn,
          createdAt,
        }) => ({
          eventId,
          userId,
          isPaidMember,
          dietaryRestrictions,
          intendedMajor,
          schoolYear,
          interests,
          checkedIn,
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
      schema: withTurnstile(
        {},
        withTags(["RSVP"], {
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
      ),
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
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/checkin/event/:eventId/attendee/:userId",
    {
      schema: withRoles(
        [AppRoles.RSVP_MANAGER],
        withTags(["RSVP"], {
          summary: "Check in an RSVP for an event.",
          params: z.object({
            eventId: z.string().min(1).meta({
              description: "The previously-created event ID in the events API.",
            }),
            userId: z.string().min(1).meta({
              description: "The user ID of the RSVP to check in.",
            }),
          }),
          response: {
            200: {
              description: "Successfully checked in RSVP",
              content: {
                "application/json": {
                  schema: z.null(),
                },
              },
            },
            400: {
              description: "RSVP not found",
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

      const command = new UpdateItemCommand({
        TableName: genericConfig.RSVPDynamoTableName,
        Key: {
          PK: { S: rsvpPartitionKey },
        },
        UpdateExpression: "SET #c = :trueVal",
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeNames: {
          "#c": "checkedIn",
        },
        ExpressionAttributeValues: {
          ":trueVal": { BOOL: true },
        },
      });

      try {
        await fastify.dynamoClient.send(command);
        reply.status(200).send();
      } catch (err: any) {
        if (err.name === "ConditionalCheckFailedException") {
          reply.status(400).send();
        } else {
          throw new DatabaseInsertError({
            message: "Could not check RSVP in",
          });
        }
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
        return reply.status(204).send();
      } catch (err: any) {
        if (err.name === "TransactionCanceledException") {
          if (err.CancellationReasons[0].Code === "ConditionalCheckFailed") {
            throw new NotFoundError({
              endpointName: request.url,
            });
          }
        }

        request.log.error(err, "Failed to delete RSVP as manager");
        throw new DatabaseDeleteError({
          message: "Failed to remove RSVP.",
        });
      }
    },
  );
};

export default rsvpRoutes;
