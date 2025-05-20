import "zod-openapi/extend";
import { FastifyPluginAsync, FastifyRequest } from "fastify";
import { AppRoles } from "../../common/roles.js";
import { z } from "zod";
import { OrganizationList } from "../../common/orgs.js";
import {
  DeleteItemCommand,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { EVENT_CACHED_DURATION, genericConfig } from "../../common/config.js";
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
import { ts, withRoles, withTags } from "api/components/index.js";
import { metadataSchema } from "common/types/events.js";
import { evaluateAllRequestPolicies } from "api/plugins/evaluatePolicies.js";

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

const repeatOptions = ["weekly", "biweekly"] as const;
const zodIncludeMetadata = z.coerce
  .boolean()
  .default(false)
  .optional()
  .openapi({
    description: "If true, include metadata for each event entry.",
  });
export const CLIENT_HTTP_CACHE_POLICY = `public, max-age=${EVENT_CACHED_DURATION}, stale-while-revalidate=420, stale-if-error=3600`;
export type EventRepeatOptions = (typeof repeatOptions)[number];

const baseSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  start: z.string().openapi({
    description: "Timestamp in the America/Chicago timezone.",
    example: "2024-08-27T19:00:00",
  }),
  end: z.optional(z.string()).openapi({
    description: "Timestamp in the America/Chicago timezone.",
    example: "2024-08-27T20:00:00",
  }),
  location: z.string().openapi({
    description: "Human-friendly location name.",
    example: "Siebel Center for Computer Science",
  }),
  locationLink: z.optional(z.string().url()).openapi({
    description: "Google Maps link for easy navigation to the event location.",
    example: "https://maps.app.goo.gl/dwbBBBkfjkgj8gvA8",
  }),
  host: z.enum(OrganizationList as [string, ...string[]]),
  featured: z.boolean().default(false).openapi({
    description:
      "Whether or not the event should be shown on the ACM @ UIUC website home page (and added to Discord, as available).",
  }),
  paidEventId: z.optional(z.string().min(1)),
  metadata: metadataSchema,
});

const requestSchema = baseSchema.extend({
  repeats: z.optional(z.enum(repeatOptions)),
  repeatEnds: z.string().optional(),
});

const postRequestSchema = requestSchema.refine(
  (data) => (data.repeatEnds ? data.repeats !== undefined : true),
  {
    message: "repeats is required when repeatEnds is defined",
  },
);
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
            upcomingOnly: z.coerce.boolean().default(false).optional().openapi({
              description:
                "If true, only get events which have at least one occurance starting after the current time.",
            }),
            featuredOnly: z.coerce.boolean().default(false).optional().openapi({
              description:
                "If true, only get events which are marked as featured.",
            }),
            host: z
              .enum(OrganizationList as [string, ...string[]])
              .optional()
              .openapi({
                description: "Retrieve events only for a specific host.",
              }),
            ts,
            includeMetadata: zodIncludeMetadata,
          }),
          summary: "Retrieve calendar events with applied filters.",
          // response: { 200: getEventsSchema },
        }),
      },
      async (request, reply) => {
        const upcomingOnly = request.query?.upcomingOnly || false;
        const featuredOnly = request.query?.featuredOnly || false;
        const includeMetadata = request.query.includeMetadata || false;
        const host = request.query?.host;
        const ts = request.query?.ts; // we only use this to disable cache control
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

  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/:id?",
    {
      schema: withRoles(
        [AppRoles.EVENTS_MANAGER],
        withTags(["Events"], {
          // response: {
          //   201: z.object({
          //     id: z.string(),
          //     resource: z.string(),
          //   }),
          // },
          body: postRequestSchema,
          params: z.object({
            id: z.string().min(1).optional().openapi({
              description:
                "Event ID to modify (leave empty to create a new event).",
              example: "6667e095-8b04-4877-b361-f636f459ba42",
            }),
          }),
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
        let originalEvent;
        const userProvidedId = request.params.id;
        const entryUUID = userProvidedId || randomUUID();
        if (userProvidedId) {
          const response = await fastify.dynamoClient.send(
            new GetItemCommand({
              TableName: genericConfig.EventsDynamoTableName,
              Key: { id: { S: userProvidedId } },
            }),
          );
          originalEvent = response.Item;
          if (!originalEvent) {
            throw new ValidationError({
              message: `${userProvidedId} is not a valid event ID.`,
            });
          }
          originalEvent = unmarshall(originalEvent);
        }
        let verb = "created";
        if (userProvidedId && userProvidedId === entryUUID) {
          verb = "modified";
        }
        const entry = {
          ...request.body,
          id: entryUUID,
          createdAt:
            originalEvent && originalEvent.createdAt
              ? originalEvent.createdAt
              : new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await fastify.dynamoClient.send(
          new PutItemCommand({
            TableName: genericConfig.EventsDynamoTableName,
            Item: marshall(entry),
          }),
        );
        try {
          if (request.body.featured && !request.body.repeats) {
            await updateDiscord(
              fastify.secretConfig,
              entry,
              request.username,
              false,
              request.log,
            );
          }
        } catch (e: unknown) {
          // restore original DB status if Discord fails.
          await fastify.dynamoClient.send(
            new DeleteItemCommand({
              TableName: genericConfig.EventsDynamoTableName,
              Key: { id: { S: entryUUID } },
            }),
          );
          if (userProvidedId) {
            await fastify.dynamoClient.send(
              new PutItemCommand({
                TableName: genericConfig.EventsDynamoTableName,
                Item: originalEvent,
              }),
            );
          }

          if (e instanceof Error) {
            request.log.error(`Failed to publish event to Discord: ${e} `);
          }
          if (e instanceof BaseError) {
            throw e;
          }
          throw new DiscordEventError({});
        }
        await atomicIncrementCacheCounter(
          fastify.dynamoClient,
          `events-etag-${entryUUID}`,
          1,
          false,
        );
        await atomicIncrementCacheCounter(
          fastify.dynamoClient,
          "events-etag-all",
          1,
          false,
        );
        await createAuditLogEntry({
          dynamoClient: fastify.dynamoClient,
          entry: {
            module: Modules.EVENTS,
            actor: request.username,
            target: entryUUID,
            message: `${verb} event "${entryUUID}"`,
            requestId: request.id,
          },
        });
        reply.status(201).send({
          id: entryUUID,
          resource: `/api/v1/events/${entryUUID}`,
        });
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
            id: z.string().min(1).openapi({
              description: "Event ID to delete.",
              example: "6667e095-8b04-4877-b361-f636f459ba42",
            }),
          }),
          // response: {
          //   201: z.object({
          //     id: z.string(),
          //     resource: z.string(),
          //   }),
          // },
          summary: "Delete a calendar event.",
        }),
      ) satisfies FastifyZodOpenApiSchema,
      onRequest: fastify.authorizeFromSchema,
      preHandler: async (request, reply) => {
        if (request.policyRestrictions) {
          const response = await fastify.dynamoClient.send(
            new GetItemCommand({
              TableName: genericConfig.EventsDynamoTableName,
              Key: marshall({ id: request.params.id }),
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
        await fastify.dynamoClient.send(
          new DeleteItemCommand({
            TableName: genericConfig.EventsDynamoTableName,
            Key: marshall({ id }),
          }),
        );
        await updateDiscord(
          fastify.secretConfig,
          { id } as IUpdateDiscord,
          request.username,
          true,
          request.log,
        );
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
          id: z.string().min(1).openapi({
            description: "Event ID to delete.",
            example: "6667e095-8b04-4877-b361-f636f459ba42",
          }),
        }),
        querystring: z.object({
          ts,
          includeMetadata: zodIncludeMetadata,
        }),
        summary: "Retrieve a calendar event.",
        // response: { 200: getEventSchema },
      }),
    },
    async (request, reply) => {
      const id = request.params.id;
      const ts = request.query?.ts;
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
