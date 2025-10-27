import { FastifyPluginAsync } from "fastify";
import { AppRoles } from "../../common/roles.js";
import * as z from "zod/v4";
import {
  DeleteItemCommand,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import {
  EVENT_CACHED_DURATION,
  genericConfig,
  STALE_IF_ERROR_CACHED_TIME,
} from "../../common/config.js";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  BaseError,
  DatabaseFetchError,
  DatabaseInsertError,
  DiscordEventError,
  InternalServerError,
  NotFoundError,
  UnauthenticatedError,
  UnauthorizedError,
  ValidationError,
} from "../../common/errors/index.js";
import { randomUUID } from "crypto";
import moment from "moment-timezone";
import { IUpdateDiscord, updateDiscord } from "../functions/discord.js";
import rateLimiter from "api/plugins/rateLimiter.js";
import {
  atomicIncrementCacheCounter,
  deleteCacheCounter,
  getCacheCounter,
} from "api/functions/cache.js";
import { createAuditLogEntry } from "api/functions/auditLog.js";
import { Modules } from "common/modules.js";
import {
  FastifyPluginAsyncZodOpenApi,
  FastifyZodOpenApiSchema,
  FastifyZodOpenApiTypeProvider,
} from "fastify-zod-openapi";
import {
  acmCoreOrganization,
  notFoundError,
  ts,
  withRoles,
  withTags,
} from "api/components/index.js";
import { metadataSchema } from "common/types/events.js";
import { evaluateAllRequestPolicies } from "api/plugins/evaluatePolicies.js";
import { EVENTS_EXPIRY_AFTER_LAST_OCCURRENCE_DAYS } from "common/constants.js";

const createProjectionParams = (includeMetadata: boolean = false) => {
  // Object mapping attribute names to their expression aliases
  const attributeMapping = {
    title: "#title",
    description: "#description",
    start: "#startTime", // Reserved keyword
    end: "#endTime", // Potential reserved keyword
    location: "#location",
    locationLink: "#locationLink",
    host: "#host",
    featured: "#featured",
    id: "#id",
    repeats: "#repeats",
    repeatEnds: "#repeatEnds",
    repeatExcludes: "#repeatExcludes",
    paidEventId: "#paidEventId",
    ...(includeMetadata ? { metadata: "#metadata" } : {}),
  };

  // Create expression attribute names object for DynamoDB
  const expressionAttributeNames = Object.entries(attributeMapping).reduce(
    (acc, [attrName, exprName]) => {
      acc[exprName] = attrName;
      return acc;
    },
    {} as { [key: string]: string },
  );

  // Create projection expression from the values of attributeMapping
  const projectionExpression = Object.values(attributeMapping).join(",");

  return {
    attributeMapping,
    expressionAttributeNames,
    projectionExpression,
    // Return function to destructure results if needed
    getAttributes: <T>(item: any): T => item as T,
  };
};

const determineExpiresAt = (event: {
  repeats?: string;
  repeatEnds?: string | undefined;
  end?: string | undefined;
}) => {
  if (event.repeats && !event.repeatEnds) {
    return undefined;
  }
  const now = Math.floor(Date.now() / 1000);
  const nowExpiry = now + 86400 * EVENTS_EXPIRY_AFTER_LAST_OCCURRENCE_DAYS;
  const endAttr = event.repeats ? event.repeatEnds : event.end;
  if (!endAttr) {
    return nowExpiry;
  }

  const ends = new Date(endAttr);
  if (isNaN(ends.getTime())) {
    return nowExpiry;
  }
  const seconds =
    Math.round(ends.getTime() / 1000) +
    86400 * EVENTS_EXPIRY_AFTER_LAST_OCCURRENCE_DAYS;
  return Math.max(seconds, nowExpiry);
};

const repeatOptions = ["weekly", "biweekly"] as const;
const zodIncludeMetadata = z.coerce.boolean().default(false).optional().meta({
  description: "If true, include metadata for each event entry.",
});
export const CLIENT_HTTP_CACHE_POLICY = `public, max-age=${EVENT_CACHED_DURATION}, stale-while-revalidate=${EVENT_CACHED_DURATION * 2}, stale-if-error=${STALE_IF_ERROR_CACHED_TIME}`;
export type EventRepeatOptions = (typeof repeatOptions)[number];

const baseSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  start: z.string().meta({
    description: "Timestamp in the America/Chicago timezone.",
    example: "2024-08-27T19:00:00",
  }),
  end: z.optional(z.string()).meta({
    description: "Timestamp in the America/Chicago timezone.",
    example: "2024-08-27T20:00:00",
  }),
  location: z.string().meta({
    description: "Human-friendly location name.",
    example: "Siebel Center for Computer Science",
  }),
  locationLink: z.optional(z.string().url()).meta({
    description: "Google Maps link for easy navigation to the event location.",
    example: "https://maps.app.goo.gl/dwbBBBkfjkgj8gvA8",
  }),
  host: acmCoreOrganization,
  featured: z.boolean().default(false).meta({
    ref: "featuredEventBool",
    description:
      "Whether or not the event should be shown on the ACM @ UIUC website home page (and added to Discord, as available).",
  }),
  paidEventId: z.optional(z.string().min(1)),
  metadata: metadataSchema,
});

const requestSchema = baseSchema.extend({
  repeats: z.optional(z.enum(repeatOptions)),
  repeatEnds: z.string().optional(),
  repeatExcludes: z.array(z.string().date()).max(100).optional().meta({
    description:
      "Dates to exclude from recurrence rules (in the America/Chicago timezone).",
  }),
});

const postRequestSchema = requestSchema
  .extend({
    description: z.string().min(1).max(250),
  })
  .refine((data) => (data.repeatEnds ? data.repeats !== undefined : true), {
    message: "repeats is required when repeatEnds is defined",
  })
  .refine((data) => (data.repeatExcludes ? data.repeats !== undefined : true), {
    message: "repeats is required when repeatExcludes is defined",
  });

export type EventPostRequest = z.infer<typeof postRequestSchema>;

const getEventSchema = requestSchema.extend({
  id: z.string(),
});
export type EventGetResponse = z.infer<typeof getEventSchema>;

const getEventsSchema = z.array(getEventSchema);
export type EventsGetResponse = z.infer<typeof getEventsSchema>;

const eventsPlugin: FastifyPluginAsyncZodOpenApi = async (
  fastify,
  _options,
) => {
  const limitedRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.register(rateLimiter, {
      limit: 30,
      duration: 60,
      rateLimitIdentifier: "events",
    });
    fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
      "",
      {
        schema: withTags(["Events"], {
          querystring: z.object({
            upcomingOnly: z.coerce.boolean().default(false).optional().meta({
              description:
                "If true, only get events which have at least one occurance starting after the current time.",
            }),
            featuredOnly: z.coerce.boolean().default(false).optional().meta({
              description:
                "If true, only get events which are marked as featured.",
            }),
            host: z.optional(acmCoreOrganization).meta({
              description: "Retrieve events only for this organization.",
            }),
            ts,
            includeMetadata: zodIncludeMetadata,
          }),
          summary: "Retrieve calendar events with applied filters.",
          response: {
            200: {
              content: {
                "application/json": {
                  schema: z.array(getEventSchema),
                  description: "Event data matching specified filter.",
                },
              },
            },
          },
        }),
      },
      async (request, reply) => {
        const upcomingOnly = request.query?.upcomingOnly || false;
        const featuredOnly = request.query?.featuredOnly || false;
        const includeMetadata = request.query.includeMetadata || false;
        const host = request.query?.host;
        const ts = request.query?.ts; // we only use this to disable cache control
        if (ts) {
          // cache bypass requires auth
          try {
            await fastify.authorize(request, reply, [], false);
          } catch (e) {
            throw new UnauthenticatedError({
              message:
                "You must be authenticated to specify a staleness bound.",
            });
          }
        }
        const projection = createProjectionParams(includeMetadata);
        try {
          const ifNoneMatch = request.headers["if-none-match"];
          if (ifNoneMatch) {
            const etag = await getCacheCounter(
              fastify.dynamoClient,
              "events-etag-all",
            );

            if (
              ifNoneMatch === `"${etag.toString()}"` ||
              ifNoneMatch === etag.toString()
            ) {
              return reply
                .code(304)
                .header("ETag", etag)
                .header("Cache-Control", CLIENT_HTTP_CACHE_POLICY)
                .send();
            }
            reply.header("etag", etag);
          }
          let command;
          if (host) {
            command = new QueryCommand({
              TableName: genericConfig.EventsDynamoTableName,
              ExpressionAttributeValues: {
                ":host": {
                  S: host,
                },
              },
              KeyConditionExpression: "host = :host",
              IndexName: "HostIndex",
              ProjectionExpression: projection.projectionExpression,
              ExpressionAttributeNames: projection.expressionAttributeNames,
            });
          } else {
            command = new ScanCommand({
              TableName: genericConfig.EventsDynamoTableName,
              ProjectionExpression: projection.projectionExpression,
              ExpressionAttributeNames: projection.expressionAttributeNames,
            });
          }
          if (!ifNoneMatch) {
            const etag = await getCacheCounter(
              fastify.dynamoClient,
              "events-etag-all",
            );
            reply.header("etag", etag);
          }

          const response = await fastify.dynamoClient.send(command);
          const items = response.Items?.map((item) => unmarshall(item));
          const currentTimeChicago = moment().tz("America/Chicago");
          let parsedItems = getEventsSchema.parse(items);
          if (upcomingOnly) {
            parsedItems = parsedItems.filter((item) => {
              try {
                if (item.repeats && !item.repeatEnds) {
                  return true;
                }
                if (!item.repeats) {
                  const end = item.end || item.start;
                  const momentEnds = moment.tz(end, "America/Chicago");
                  const diffTime = currentTimeChicago.diff(momentEnds);
                  return Boolean(
                    diffTime <= genericConfig.UpcomingEventThresholdSeconds,
                  );
                }
                const momentRepeatEnds = moment.tz(
                  item.repeatEnds,
                  "America/Chicago",
                );
                const diffTime = currentTimeChicago.diff(momentRepeatEnds);
                return Boolean(
                  diffTime <= genericConfig.UpcomingEventThresholdSeconds,
                );
              } catch (e: unknown) {
                request.log.warn(
                  `Could not compute upcoming event status for event ${item.title}: ${e instanceof Error ? e.toString() : e} `,
                );
                return false;
              }
            });
          }
          if (featuredOnly) {
            parsedItems = parsedItems.filter((x) => x.featured);
          }
          if (!ts) {
            reply.header("Cache-Control", CLIENT_HTTP_CACHE_POLICY);
          }
          return reply.send(parsedItems);
        } catch (e: unknown) {
          if (e instanceof Error) {
            request.log.error(`Failed to get from DynamoDB: ${e.toString()}`);
          } else {
            request.log.error(`Failed to get from DynamoDB.${e} `);
          }
          throw new DatabaseFetchError({
            message: "Failed to get events from Dynamo table.",
          });
        }
      },
    );
  };
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().patch(
    "/:id",
    {
      schema: withRoles(
        [AppRoles.EVENTS_MANAGER],
        withTags(["Events"], {
          body: postRequestSchema,
          params: z.object({
            id: z.string().min(1).meta({
              description: "Event ID to modify.",
              example: "6667e095-8b04-4877-b361-f636f459ba42",
            }),
          }),
          response: {
            201: {
              description: "The event has been modified successfully.",
            },
            404: notFoundError,
          },
          summary: "Modify a calendar event.",
        }),
      ) satisfies FastifyZodOpenApiSchema,
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      if (!request.username) {
        throw new UnauthenticatedError({ message: "Username not found." });
      }

      try {
        const entryUUID = request.params.id;
        const updatedItem = {
          ...request.body,
          id: entryUUID,
          updatedAt: new Date().toISOString(),
        };
        const expiresAt = determineExpiresAt(updatedItem);
        const command = new PutItemCommand({
          TableName: genericConfig.EventsDynamoTableName,
          Item: marshall(
            { ...updatedItem, expiresAt },
            { removeUndefinedValues: true },
          ),
          ConditionExpression: "attribute_exists(id)",
          ReturnValues: "ALL_OLD",
        });

        let oldAttributes;
        try {
          const result = await fastify.dynamoClient.send(command);
          oldAttributes = result.Attributes;
          if (!oldAttributes) {
            throw new NotFoundError({ endpointName: request.url });
          }
        } catch (e: unknown) {
          if (
            e instanceof Error &&
            e.name === "ConditionalCheckFailedException"
          ) {
            throw new NotFoundError({ endpointName: request.url });
          }
          if (e instanceof BaseError) {
            throw e;
          }
          request.log.error(e);
          throw new DatabaseInsertError({
            message: "Failed to update event in Dynamo table.",
          });
        }
        oldAttributes = unmarshall(oldAttributes);
        const updatedEntryForDiscord = {
          ...updatedItem,
          discordEventId: oldAttributes.discordEventId,
        } as unknown as IUpdateDiscord;

        if (
          updatedEntryForDiscord.featured &&
          !updatedEntryForDiscord.repeats
        ) {
          try {
            const discordEventId = await updateDiscord(
              {
                botToken: fastify.secretConfig.discord_bot_token,
                guildId: fastify.environmentConfig.DiscordGuildId,
              },
              updatedEntryForDiscord,
              request.username,
              false,
              request.log,
            );

            if (discordEventId) {
              await fastify.dynamoClient.send(
                new UpdateItemCommand({
                  TableName: genericConfig.EventsDynamoTableName,
                  Key: { id: { S: entryUUID } },
                  UpdateExpression: "SET #discordEventId = :discordEventId",
                  ExpressionAttributeNames: {
                    "#discordEventId": "discordEventId",
                  },
                  ExpressionAttributeValues: {
                    ":discordEventId": { S: discordEventId },
                  },
                }),
              );
            }
          } catch (e) {
            await fastify.dynamoClient.send(
              new PutItemCommand({
                TableName: genericConfig.EventsDynamoTableName,
                Item: oldAttributes!,
              }),
            );

            if (e instanceof Error) {
              request.log.error(`Failed to publish event to Discord: ${e}`);
            }
          }
        }

        const postUpdatePromises = [
          atomicIncrementCacheCounter(
            fastify.dynamoClient,
            `events-etag-${entryUUID}`,
            1,
            false,
            expiresAt,
          ),
          atomicIncrementCacheCounter(
            fastify.dynamoClient,
            "events-etag-all",
            1,
            false,
          ),
          createAuditLogEntry({
            dynamoClient: fastify.dynamoClient,
            entry: {
              module: Modules.EVENTS,
              actor: request.username,
              target: entryUUID,
              message: "Updated target event.",
              requestId: request.id,
            },
          }),
        ];
        await Promise.all(postUpdatePromises);
        reply.header("location", request.url);
        reply.status(201).send();
      } catch (e: unknown) {
        if (e instanceof Error) {
          request.log.error(`Failed to update DynamoDB: ${e.toString()}`);
        }
        if (e instanceof BaseError) {
          throw e;
        }
        throw new DatabaseInsertError({
          message: "Failed to update event in Dynamo table.",
        });
      }
    },
  );

  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "",
    {
      schema: withRoles(
        [AppRoles.EVENTS_MANAGER],
        withTags(["Events"], {
          body: postRequestSchema,
          response: {
            201: {
              description:
                "Event created. The 'Location' header specifies the URL of the created event.",
              content: {
                "application/json": {
                  schema: z.null(),
                },
              },
            },
          },
          summary: "Create a calendar event.",
        }),
      ) satisfies FastifyZodOpenApiSchema,
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      if (!request.username) {
        throw new UnauthenticatedError({ message: "Username not found." });
      }
      try {
        const expiresAt = determineExpiresAt(request.body);
        const entryUUID = randomUUID();
        const entry = {
          ...request.body,
          id: entryUUID,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          expiresAt,
        };
        await fastify.dynamoClient.send(
          new PutItemCommand({
            TableName: genericConfig.EventsDynamoTableName,
            ConditionExpression: "attribute_not_exists(id)",
            Item: marshall(entry, { removeUndefinedValues: true }),
          }),
        );
        try {
          if (request.body.featured && !request.body.repeats) {
            const discordEventId = await updateDiscord(
              {
                botToken: fastify.secretConfig.discord_bot_token,
                guildId: fastify.environmentConfig.DiscordGuildId,
              },
              entry,
              request.username,
              false,
              request.log,
            );
            if (discordEventId) {
              await fastify.dynamoClient.send(
                new UpdateItemCommand({
                  TableName: genericConfig.EventsDynamoTableName,
                  Key: { id: { S: entryUUID } },
                  UpdateExpression: "SET #discordEventId = :discordEventId",
                  ExpressionAttributeNames: {
                    "#discordEventId": "discordEventId",
                  },
                  ExpressionAttributeValues: {
                    ":discordEventId": { S: discordEventId },
                  },
                }),
              );
            }
          }
        } catch (e: unknown) {
          // restore original DB status if Discord fails.
          await fastify.dynamoClient.send(
            new DeleteItemCommand({
              TableName: genericConfig.EventsDynamoTableName,
              Key: { id: { S: entryUUID } },
            }),
          );

          if (e instanceof Error) {
            request.log.error(`Failed to publish event to Discord: ${e} `);
          }
          if (e instanceof BaseError) {
            throw e;
          }
          throw new DiscordEventError({});
        }
        const postUpdatePromises = [
          atomicIncrementCacheCounter(
            fastify.dynamoClient,
            `events-etag-${entryUUID}`,
            1,
            false,
            expiresAt,
          ),
          atomicIncrementCacheCounter(
            fastify.dynamoClient,
            "events-etag-all",
            1,
            false,
            undefined,
          ),
          createAuditLogEntry({
            dynamoClient: fastify.dynamoClient,
            entry: {
              module: Modules.EVENTS,
              actor: request.username,
              target: entryUUID,
              message: "Created target event.",
              requestId: request.id,
            },
          }),
        ];
        await Promise.all(postUpdatePromises);
        reply
          .status(201)
          .header(
            "Location",
            `${fastify.environmentConfig.UserFacingUrl}/api/v1/events/${entryUUID}`,
          )
          .send();
      } catch (e: unknown) {
        if (e instanceof Error) {
          request.log.error(`Failed to insert to DynamoDB: ${e.toString()}`);
        }
        if (e instanceof BaseError) {
          throw e;
        }
        throw new DatabaseInsertError({
          message: "Failed to insert event to Dynamo table.",
        });
      }
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().delete(
    "/:id",
    {
      schema: withRoles(
        [AppRoles.EVENTS_MANAGER],
        withTags(["Events"], {
          params: z.object({
            id: z.string().min(1).meta({
              description: "Event ID to delete.",
              example: "6667e095-8b04-4877-b361-f636f459ba42",
            }),
          }),
          response: {
            204: {
              description: "The event has been deleted.",
              content: {
                "application/json": {
                  schema: z.null(),
                },
              },
            },
            404: notFoundError,
          },
          summary: "Delete a calendar event.",
        }),
      ) satisfies FastifyZodOpenApiSchema,
      onRequest: fastify.authorizeFromSchema,
      preHandler: async (request, reply) => {
        if (request.policyRestrictions) {
          const response = await fastify.dynamoClient.send(
            new GetItemCommand({
              TableName: genericConfig.EventsDynamoTableName,
              Key: marshall(
                { id: request.params.id },
                { removeUndefinedValues: true },
              ),
            }),
          );
          const item = response.Item ? unmarshall(response.Item) : null;
          if (!item) {
            return reply.status(204).send();
          }
          const fakeBody = { ...request, body: item, url: request.url };
          try {
            const result = await evaluateAllRequestPolicies(fakeBody);
            if (typeof result === "string") {
              throw new UnauthorizedError({
                message: result,
              });
            }
          } catch (err) {
            if (err instanceof BaseError) {
              throw err;
            }
            fastify.log.error(err);
            throw new InternalServerError({
              message: "Failed to evaluate policies.",
            });
          }
        }
      },
    },
    async (request, reply) => {
      const id = request.params.id;
      if (!request.username) {
        throw new UnauthenticatedError({ message: "Username not found." });
      }
      try {
        const result = await fastify.dynamoClient.send(
          new DeleteItemCommand({
            TableName: genericConfig.EventsDynamoTableName,
            Key: marshall({ id }),
            ReturnValues: "ALL_OLD",
          }),
        );
        if (result.Attributes) {
          const unmarshalledResult = unmarshall(result.Attributes);
          await updateDiscord(
            {
              botToken: fastify.secretConfig.discord_bot_token,
              guildId: fastify.environmentConfig.DiscordGuildId,
            },
            unmarshalledResult as IUpdateDiscord,
            request.username,
            true,
            request.log,
          );
        }
        await deleteCacheCounter(fastify.dynamoClient, `events-etag-${id}`);
        reply.status(204).send();
        await createAuditLogEntry({
          dynamoClient: fastify.dynamoClient,
          entry: {
            module: Modules.EVENTS,
            actor: request.username,
            target: id,
            message: `Deleted event "${id}"`,
            requestId: request.id,
          },
        });
      } catch (e: unknown) {
        if (e instanceof Error) {
          request.log.error(`Failed to delete from DynamoDB: ${e.toString()}`);
        }
        throw new DatabaseInsertError({
          message: "Failed to delete event from Dynamo table.",
        });
      }
      await deleteCacheCounter(fastify.dynamoClient, `events-etag-${id}`);
      await atomicIncrementCacheCounter(
        fastify.dynamoClient,
        "events-etag-all",
        1,
        false,
      );
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/:id",
    {
      schema: withTags(["Events"], {
        params: z.object({
          id: z.string().min(1).meta({
            description: "Event ID to delete.",
            example: "6667e095-8b04-4877-b361-f636f459ba42",
          }),
        }),
        querystring: z.object({
          ts,
          includeMetadata: zodIncludeMetadata,
        }),
        response: {
          200: {
            description: "Event data.",
            content: {
              "application/json": {
                schema: getEventSchema,
              },
            },
          },
          404: notFoundError,
        },
        summary: "Retrieve a calendar event.",
      }),
    },
    async (request, reply) => {
      const id = request.params.id;
      const ts = request.query?.ts;
      if (ts) {
        // cache bypass requires auth
        try {
          await fastify.authorize(request, reply, [], false);
        } catch (e) {
          throw new UnauthenticatedError({
            message: "You must be authenticated to specify a staleness bound.",
          });
        }
      }
      const includeMetadata = request.query?.includeMetadata || false;

      try {
        // Check If-None-Match header
        const ifNoneMatch = request.headers["if-none-match"];
        if (ifNoneMatch) {
          const etag = await getCacheCounter(
            fastify.dynamoClient,
            `events-etag-${id}`,
          );

          if (
            ifNoneMatch === `"${etag.toString()}"` ||
            ifNoneMatch === etag.toString()
          ) {
            return reply
              .code(304)
              .header("ETag", etag)
              .header("Cache-Control", CLIENT_HTTP_CACHE_POLICY)
              .send();
          }

          reply.header("etag", etag);
        }
        const projection = createProjectionParams(includeMetadata);
        const response = await fastify.dynamoClient.send(
          new GetItemCommand({
            TableName: genericConfig.EventsDynamoTableName,
            Key: marshall({ id }),
            ProjectionExpression: projection.projectionExpression,
            ExpressionAttributeNames: projection.expressionAttributeNames,
          }),
        );
        const item = response.Item ? unmarshall(response.Item) : null;
        if (!item) {
          throw new NotFoundError({ endpointName: request.url });
        }

        if (!ts) {
          reply.header("Cache-Control", CLIENT_HTTP_CACHE_POLICY);
        }

        // Only get the etag now if we didn't already get it above
        if (!ifNoneMatch) {
          const etag = await getCacheCounter(
            fastify.dynamoClient,
            `events-etag-${id}`,
          );
          reply.header("etag", etag);
        }

        return reply.send(item as z.infer<typeof getEventSchema>);
      } catch (e) {
        if (e instanceof BaseError) {
          throw e;
        }
        fastify.log.error(e);
        throw new DatabaseFetchError({
          message: "Failed to get event from Dynamo table.",
        });
      }
    },
  );
  fastify.register(limitedRoutes);
};

export default eventsPlugin;
