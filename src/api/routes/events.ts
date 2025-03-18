import { FastifyPluginAsync, FastifyRequest } from "fastify";
import { AppRoles } from "../../common/roles.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { OrganizationList } from "../../common/orgs.js";
import {
  DeleteItemCommand,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { genericConfig } from "../../common/config.js";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  BaseError,
  DatabaseFetchError,
  DatabaseInsertError,
  DiscordEventError,
  NotFoundError,
  ValidationError,
} from "../../common/errors/index.js";
import { randomUUID } from "crypto";
import moment from "moment-timezone";
import { IUpdateDiscord, updateDiscord } from "../functions/discord.js";

// POST

const repeatOptions = ["weekly", "biweekly"] as const;
const EVENT_CACHE_SECONDS = 90;
export type EventRepeatOptions = (typeof repeatOptions)[number];

const baseSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  start: z.string(),
  end: z.optional(z.string()),
  location: z.string(),
  locationLink: z.optional(z.string().url()),
  host: z.enum(OrganizationList as [string, ...string[]]),
  featured: z.boolean().default(false),
  paidEventId: z.optional(z.string().min(1)),
});

const requestSchema = baseSchema.extend({
  repeats: z.optional(z.enum(repeatOptions)),
  repeatEnds: z.string().optional(),
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const postRequestSchema = requestSchema.refine(
  (data) => (data.repeatEnds ? data.repeats !== undefined : true),
  {
    message: "repeats is required when repeatEnds is defined",
  },
);

export type EventPostRequest = z.infer<typeof postRequestSchema>;
type EventGetRequest = {
  Params: { id: string };
  Querystring: undefined;
  Body: undefined;
};

const responseJsonSchema = zodToJsonSchema(
  z.object({
    id: z.string(),
    resource: z.string(),
  }),
);

// GET
const getEventSchema = requestSchema.extend({
  id: z.string(),
});

export type EventGetResponse = z.infer<typeof getEventSchema>;
const getEventJsonSchema = zodToJsonSchema(getEventSchema);

const getEventsSchema = z.array(getEventSchema);
export type EventsGetResponse = z.infer<typeof getEventsSchema>;
type EventsGetQueryParams = {
  upcomingOnly?: boolean;
  host?: string;
  ts?: number;
};

const eventsPlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.post<{ Body: EventPostRequest }>(
    "/:id?",
    {
      schema: {
        response: { 201: responseJsonSchema },
      },
      preValidation: async (request, reply) => {
        await fastify.zodValidateBody(request, reply, postRequestSchema);
      },
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [AppRoles.EVENTS_MANAGER]);
      },
    },
    async (request, reply) => {
      try {
        let originalEvent;
        const userProvidedId = (
          request.params as Record<string, string | undefined>
        ).id;
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
        }
        const entry = {
          ...request.body,
          id: entryUUID,
          createdBy: request.username,
          createdAt: originalEvent
            ? originalEvent.createdAt || new Date().toISOString()
            : new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await fastify.dynamoClient.send(
          new PutItemCommand({
            TableName: genericConfig.EventsDynamoTableName,
            Item: marshall(entry),
          }),
        );
        let verb = "created";
        if (userProvidedId && userProvidedId === entryUUID) {
          verb = "modified";
        }
        try {
          if (request.body.featured && !request.body.repeats) {
            await updateDiscord(
              fastify.secretsManagerClient,
              entry,
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
        reply.status(201).send({
          id: entryUUID,
          resource: `/api/v1/events/${entryUUID}`,
        });
        request.log.info(
          { type: "audit", actor: request.username, target: entryUUID },
          `${verb} event "${entryUUID}"`,
        );
      } catch (e: unknown) {
        if (e instanceof Error) {
          request.log.error("Failed to insert to DynamoDB: " + e.toString());
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
  fastify.get<EventGetRequest>(
    "/:id",
    {
      schema: {
        response: { 200: getEventJsonSchema },
      },
    },
    async (request: FastifyRequest<EventGetRequest>, reply) => {
      const id = request.params.id;
      try {
        const response = await fastify.dynamoClient.send(
          new QueryCommand({
            TableName: genericConfig.EventsDynamoTableName,
            KeyConditionExpression: "#id = :id",
            ExpressionAttributeNames: {
              "#id": "id",
            },
            ExpressionAttributeValues: marshall({ ":id": id }),
          }),
        );
        const items = response.Items?.map((item) => unmarshall(item));
        if (items?.length !== 1) {
          throw new NotFoundError({
            endpointName: request.url,
          });
        }
        reply.send(items[0]);
      } catch (e: unknown) {
        if (e instanceof BaseError) {
          throw e;
        }
        if (e instanceof Error) {
          request.log.error("Failed to get from DynamoDB: " + e.toString());
        }
        throw new DatabaseFetchError({
          message: "Failed to get event from Dynamo table.",
        });
      }
    },
  );
  type EventDeleteRequest = {
    Params: { id: string };
    Querystring: undefined;
    Body: undefined;
  };
  fastify.delete<EventDeleteRequest>(
    "/:id",
    {
      schema: {
        response: { 201: responseJsonSchema },
      },
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [AppRoles.EVENTS_MANAGER]);
      },
    },
    async (request: FastifyRequest<EventDeleteRequest>, reply) => {
      const id = request.params.id;
      try {
        await fastify.dynamoClient.send(
          new DeleteItemCommand({
            TableName: genericConfig.EventsDynamoTableName,
            Key: marshall({ id }),
          }),
        );
        await updateDiscord(
          fastify.secretsManagerClient,
          { id } as IUpdateDiscord,
          true,
          request.log,
        );
        reply.status(201).send({
          id,
          resource: `/api/v1/events/${id}`,
        });
      } catch (e: unknown) {
        if (e instanceof Error) {
          request.log.error("Failed to delete from DynamoDB: " + e.toString());
        }
        throw new DatabaseInsertError({
          message: "Failed to delete event from Dynamo table.",
        });
      }
      request.log.info(
        { type: "audit", actor: request.username, target: id },
        `deleted event "${id}"`,
      );
    },
  );
  type EventsGetRequest = {
    Body: undefined;
    Querystring?: EventsGetQueryParams;
  };
  fastify.get<EventsGetRequest>(
    "/",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            upcomingOnly: { type: "boolean" },
            host: { type: "string" },
            ts: { type: "number" },
          },
        },
        response: { 200: getEventsSchema },
      },
    },
    async (request: FastifyRequest<EventsGetRequest>, reply) => {
      const upcomingOnly = request.query?.upcomingOnly || false;
      const host = request.query?.host;
      const ts = request.query?.ts; // we only use this to disable cache control
      const cachedResponse = fastify.nodeCache.get(
        `events-upcoming_only=${upcomingOnly}|host=${host}`,
      );
      if (cachedResponse) {
        return reply
          .header(
            "cache-control",
            ts
              ? "no-store, no-cache, max-age=0, must-revalidate, proxy-revalidate"
              : "public, max-age=7200, stale-while-revalidate=900, stale-if-error=86400",
          )
          .header("x-acm-cache-status", "hit")
          .send(cachedResponse);
      }
      try {
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
          });
        } else {
          command = new ScanCommand({
            TableName: genericConfig.EventsDynamoTableName,
          });
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
        fastify.nodeCache.set(
          `events-upcoming_only=${upcomingOnly}`,
          parsedItems,
          EVENT_CACHE_SECONDS,
        );
        reply
          .header(
            "cache-control",
            ts
              ? "no-store, no-cache, max-age=0, must-revalidate, proxy-revalidate"
              : "public, max-age=7200, stale-while-revalidate=900, stale-if-error=86400",
          )
          .header("x-acm-cache-status", "miss")
          .send(parsedItems);
      } catch (e: unknown) {
        if (e instanceof Error) {
          request.log.error("Failed to get from DynamoDB: " + e.toString());
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

export default eventsPlugin;
