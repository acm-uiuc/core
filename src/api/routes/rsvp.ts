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
  TransactionCanceledException,
  ConditionalCheckFailedException,
  ResourceNotFoundException,
} from "@aws-sdk/client-dynamodb";
import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";
import {
  DatabaseFetchError,
  DatabaseInsertError,
  ResourceConflictError,
  NotFoundError,
  ValidationError,
  DatabaseDeleteError,
  BaseError,
  PendingProvisioningError,
} from "common/errors/index.js";
import {
  rsvpConfigSchema,
  rsvpItemSchema,
  rsvpProfileSchema,
} from "common/types/rsvp.js";
import * as z from "zod/v4";
import { verifyUiucAccessToken, getUserIdByUin } from "api/functions/uin.js";
import { checkPaidMembership } from "api/functions/membership.js";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import { genericConfig } from "common/config.js";
import { AppRoles } from "common/roles.js";
import { EmptyResponse } from "common/types/generic.js";

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
          body: rsvpProfileSchema,
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
                  schema: EmptyResponse,
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

      const {
        gradYear,
        gradMonth,
        expectedDegree,
        intendedMajor,
        interests,
        dietaryRestrictions,
      } = request.body;

      try {
        await fastify.dynamoClient.send(
          new UpdateItemCommand({
            TableName: genericConfig.UserInfoTable,
            Key: marshall({
              id: upn,
            }),
            UpdateExpression:
              "SET #gradYear = :gradYear, #gradMonth = :gradMonth, #expectedDegree = :expectedDegree, #intendedMajor = :intendedMajor, #interests = :interests, #dietaryRestrictions = :dietaryRestrictions",
            ExpressionAttributeNames: {
              "#gradYear": "gradYear",
              "#gradMonth": "gradMonth",
              "#expectedDegree": "expectedDegree",
              "#intendedMajor": "intendedMajor",
              "#interests": "interests",
              "#dietaryRestrictions": "dietaryRestrictions",
            },
            ExpressionAttributeValues: marshall({
              ":gradYear": gradYear,
              ":gradMonth": gradMonth,
              ":expectedDegree": expectedDegree,
              ":intendedMajor": intendedMajor,
              ":interests": interests || [],
              ":dietaryRestrictions": dietaryRestrictions || [],
            }),
          }),
        );
        request.log.info(
          `Updated user ${upn} at ${Date.now().toLocaleString()}`,
        );
        return reply.status(201).send();
      } catch (err) {
        if (err instanceof BaseError) {
          throw err;
        }
        request.log.error(
          err,
          "Failed to update UserInfoTable with RSVP profile",
        );
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

      const getCommand = new GetItemCommand({
        TableName: genericConfig.UserInfoTable,
        Key: marshall({ id: upn }),
      });

      let response;
      try {
        response = await fastify.dynamoClient.send(getCommand);
      } catch (err) {
        if (err instanceof BaseError) {
          throw err;
        }
        request.log.error(err, "Failed to fetch user from UserInfoTable");
        throw new DatabaseFetchError({
          message: "Failed to retrieve user from database.",
        });
      }

      if (!response || !response.Item) {
        throw new DatabaseFetchError({
          message: "Failed to retrieve user from database.",
        });
      }

      let profileItem;

      try {
        const rawItem = unmarshall(response.Item);

        if (
          !rawItem.gradYear ||
          !rawItem.gradMonth ||
          !rawItem.expectedDegree ||
          !rawItem.intendedMajor
        ) {
          throw new PendingProvisioningError({
            message: `Profile has not been created yet`,
          });
        }
        profileItem = rsvpProfileSchema.parse(rawItem);
      } catch (err) {
        if (err instanceof BaseError) {
          throw err;
        }
        request.log.error(
          err,
          "Failed to parse RSVP profile data from UserInfoTable",
        );
        throw new DatabaseFetchError({
          message: "Could not retrieve profile. Data is malformed.",
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
                schema: EmptyResponse,
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

      const key = { id: upn };

      try {
        await fastify.dynamoClient.send(
          new UpdateItemCommand({
            TableName: genericConfig.UserInfoTable,
            Key: marshall(key),
            UpdateExpression:
              "SET REMOVE #gradYear, #gradMonth, #expectedDegree, #intendedMajor, #interests, #dietaryRestrictions",
            ExpressionAttributeNames: {
              "#gradYear": "gradYear",
              "#gradMonth": "gradMonth",
              "#expectedDegree": "expectedDegree",
              "#intendedMajor": "intendedMajor",
              "#interests": "interests",
              "#dietaryRestrictions": "dietaryRestrictions",
            },
          }),
        );
      } catch (err) {
        if (err instanceof BaseError) {
          throw err;
        }
        request.log.error(
          err,
          "Failed to remove RSVP fields from UserInfoTable",
        );
        throw new DatabaseDeleteError({ message: "Could not delete profile." });
      }
      request.log.info(`Updated user ${upn} at ${Date.now().toLocaleString()}`);
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
              content: { "application/json": { schema: EmptyResponse } },
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
      const profileKey = { id: upn };

      const [configResponse, profileResponse] = await Promise.all([
        fastify.dynamoClient.send(
          new GetItemCommand({
            TableName: genericConfig.RSVPDynamoTableName,
            Key: marshall(configKey),
          }),
        ),
        fastify.dynamoClient.send(
          new GetItemCommand({
            TableName: genericConfig.UserInfoTable,
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
        gradYear: profileItem.gradYear,
        gradMonth: profileItem.gradMonth,
        expectedDegree: profileItem.expectedDegree,
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
      } catch (err) {
        if (err instanceof BaseError) {
          throw err;
        }
        if (err instanceof TransactionCanceledException) {
          if (err.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed") {
            throw new ResourceConflictError({
              message: "You have already RSVP'd for this event.",
            });
          }
          if (err.CancellationReasons?.[1]?.Code === "ConditionalCheckFailed") {
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
          gradYear,
          gradMonth,
          expectedDegree,
          interests,
          checkedIn,
          createdAt,
        }) => ({
          eventId,
          userId,
          isPaidMember,
          dietaryRestrictions: dietaryRestrictions ?? [],
          intendedMajor: intendedMajor ?? "Unknown",
          gradYear,
          gradMonth,
          expectedDegree,
          interests: interests ?? [],
          checkedIn: checkedIn ?? false,
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
                  schema: EmptyResponse,
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
              ConditionExpression:
                "attribute_exists(id) AND rsvpEnabled = :true",
              ExpressionAttributeValues: marshall({ ":true": true }),
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
      } catch (err) {
        if (err instanceof BaseError) {
          throw err;
        }
        if (err instanceof TransactionCanceledException) {
          if (err.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed") {
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

      const checkEventCommand = new GetItemCommand({
        TableName: genericConfig.EventsDynamoTableName,
        Key: marshall({ id: eventId }),
        ProjectionExpression: "id, rsvpEnabled",
      });

      try {
        const eventResponse =
          await fastify.dynamoClient.send(checkEventCommand);
        if (!eventResponse.Item) {
          throw new NotFoundError({
            endpointName: request.url,
          });
        }
        const eventItem = unmarshall(eventResponse.Item);
        if (!eventItem.rsvpEnabled) {
          throw new ResourceConflictError({
            message: "RSVP is not enabled for this event.",
          });
        }
      } catch (err) {
        if (err instanceof BaseError) {
          throw err;
        }
        if (err instanceof ResourceNotFoundException) {
          throw new NotFoundError({
            endpointName: request.url,
          });
        }
        request.log.error(err, "Failed to verify event existence");
        throw new DatabaseFetchError({
          message: "Failed to fetch event information.",
        });
      }

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
        if (configItem.rsvpLimit === null) {
          delete configItem.rsvpLimit;
        }
        return reply.send(configItem);
      } catch (err) {
        if (err instanceof BaseError) {
          throw err;
        }
        if (err instanceof ResourceNotFoundException) {
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
          gradYear,
          gradMonth,
          expectedDegree,
          interests,
          checkedIn,
          createdAt,
        }) => ({
          eventId,
          userId,
          isPaidMember,
          dietaryRestrictions: dietaryRestrictions ?? [],
          intendedMajor: intendedMajor ?? "Unknown",
          gradYear,
          gradMonth,
          expectedDegree,
          interests: interests ?? [],
          checkedIn: checkedIn ?? false,
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
                  schema: EmptyResponse,
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
      } catch (err) {
        if (err instanceof BaseError) {
          throw err;
        }
        if (err instanceof TransactionCanceledException) {
          if (err.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed") {
            return reply.status(204).send();
          }
        }

        request.log.error(err, "Failed to withdraw RSVP");
        throw new DatabaseDeleteError({
          message: "Failed to withdraw RSVP.",
        });
      }
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/checkIn/event/:eventId",
    {
      schema: withRoles(
        [AppRoles.RSVP_MANAGER],
        withTags(["RSVP"], {
          summary: "Check in an RSVP for an event.",
          params: z.object({
            eventId: z.string().min(1).meta({
              description: "The previously-created event ID in the events API.",
            }),
          }),
          body: z.object({
            uin: z.string().min(1).meta({
              description: "The UIN of the attendee to check in.",
            }),
          }),
          response: {
            200: {
              description: "Successfully checked in RSVP",
              content: {
                "application/json": {
                  schema: z.object({
                    upn: z.string().min(1).meta({
                      description: "The UPN of the checked-in attendee.",
                    }),
                    dietaryRestrictions: z.array(z.string()).meta({
                      description:
                        "Dietary restrictions of the checked-in attendee.",
                    }),
                  }),
                },
              },
            },
            400: {
              description: "RSVP not found",
              content: {
                "application/json": {
                  schema: EmptyResponse,
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      const { id: userEmail } = await getUserIdByUin({
        dynamoClient: fastify.dynamoClient,
        uin: request.body.uin,
      });

      const rsvpPartitionKey = `RSVP#${request.params.eventId}#${userEmail}`;

      const command = new UpdateItemCommand({
        TableName: genericConfig.RSVPDynamoTableName,
        Key: {
          partitionKey: { S: rsvpPartitionKey },
        },
        UpdateExpression: "SET #c = :trueVal",
        ConditionExpression: "attribute_exists(partitionKey)",
        ExpressionAttributeNames: {
          "#c": "checkedIn",
        },
        ExpressionAttributeValues: {
          ":trueVal": { BOOL: true },
        },
      });

      try {
        await fastify.dynamoClient.send(command);
      } catch (err) {
        if (err instanceof BaseError) {
          throw err;
        }
        if (
          err instanceof ConditionalCheckFailedException ||
          (err instanceof Error &&
            err.name === "ConditionalCheckFailedException")
        ) {
          return reply.status(400).send();
        }
        throw new DatabaseInsertError({
          message: "Could not check RSVP in",
        });
      }

      const partitionKey = { id: `${userEmail}` };
      const getUserCommand = new GetItemCommand({
        TableName: genericConfig.UserInfoTable,
        Key: marshall(partitionKey),
        ProjectionExpression: "dietaryRestrictions",
      });

      try {
        const userResponse = await fastify.dynamoClient.send(getUserCommand);
        if (!userResponse || !userResponse.Item) {
          return reply.status(200).send({
            upn: userEmail,
            dietaryRestrictions: [],
          });
        }
        const userItem = unmarshall(userResponse.Item);
        return reply.status(200).send({
          upn: userEmail,
          dietaryRestrictions: userItem.dietaryRestrictions || [],
        });
      } catch (err) {
        request.log.error(err, "Failed to retrieve user information");
        throw new DatabaseFetchError({
          message: "Failed to retrieve user information.",
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
                  schema: EmptyResponse,
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
      } catch (err) {
        if (err instanceof BaseError) {
          throw err;
        }
        if (err instanceof TransactionCanceledException) {
          if (err.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed") {
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
