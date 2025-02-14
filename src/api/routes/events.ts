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
  paidEventId: z.optional(z.string()),
  type: z.literal(undefined),
});

const requestSchema = baseSchema.extend({
  repeats: z.optional(z.enum(repeatOptions)),
  repeatEnds: z.string().optional(),
});

const ticketEventSchema = requestSchema.extend({
  type: z.literal("ticket"),
  event_id: z.string(),
  event_name: z.string(),
  eventCost: z.optional(z.record(z.number())),
  eventDetails: z.string(),
  eventImage: z.string(),
  event_capacity: z.number(),
  event_sales_active_utc: z.number(),
  event_time: z.number(),
  member_price: z.optional(z.string()),
  nonmember_price: z.optional(z.string()),
  tickets_sold: z.number(),
});

const merchEventSchema = requestSchema.extend({
  type: z.literal("merch"),
  item_id: z.string(),
  item_email_desc: z.string(),
  item_image: z.string(),
  item_name: z.string(),
  item_price: z.optional(z.record(z.string(), z.number())),
  item_sales_active_utc: z.number(),
  limit_per_person: z.number(),
  member_price: z.optional(z.string()),
  nonmember_price: z.optional(z.string()),
  ready_for_pickup: z.boolean(),
  sizes: z.optional(z.array(z.string())),
  total_avail: z.optional(z.record(z.string(), z.string())),
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const postRequestSchema = requestSchema.refine(
  (data) => (data.repeatEnds ? data.repeats !== undefined : true),
  {
    message: "repeats is required when repeatEnds is defined",
  },
);

/*.refine(
  (data) => (data.paidEventId === undefined), 
  {
    message: "paidEventId should be empty if you are not creating a paid event",
  },
)*/ //Potential check here in case people creates event with a paideventid but no other entry so zod validates to just a normal event

const postTicketEventSchema = ticketEventSchema.refine(
  (data) =>
    data.paidEventId !== undefined && data.paidEventId === data.event_id,
  {
    message: "event_id needs to be the same as paidEventId", //currently useless bc if this false it will auto convert to a unpaid event...
  },
);

const postMerchEventSchema = merchEventSchema.refine(
  (data) => data.paidEventId !== undefined && data.paidEventId === data.item_id,
  {
    message: "merch_id needs to be the same as paidEventId", //currently useless bc if this false it will auto convert to a unpaid event...
  },
);

const postRefinedSchema = z.union([
  postRequestSchema,
  postMerchEventSchema,
  postTicketEventSchema,
]);
z.union([postMerchEventSchema, postTicketEventSchema]);

export type EventPostRequest = z.infer<typeof postRefinedSchema>;

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
type EventsGetQueryParams = { upcomingOnly?: boolean };

const splitter = (input: z.infer<typeof postRefinedSchema>) => {
  type entry = undefined | string | number | boolean;
  const { type, ...rest } = input;
  console.log(rest);
  let eventData: any = {}; //TODO: Need to specify type very faulty
  const paidData: { [key: string]: entry } = {};
  const eventSchemaKeys = Object.keys(requestSchema.shape);
  if (type === undefined) {
    eventData = rest as { [key: string]: entry };
  } else if (type === "ticket") {
    const data = rest as { [key: string]: entry };
    const paidSchemaKeys = [
      "event_id",
      "event_name",
      "eventCost",
      "eventDetails",
      "eventImage",
      "event_capacity",
      "event_sales_active_utc",
      "event_time",
      "member_price",
      "nonmember_price",
      "tickets_sold",
    ];
    for (const key of paidSchemaKeys) {
      if (key in data) {
        paidData[key] = data[key];
      }
    }
    for (const key of eventSchemaKeys) {
      if (key in data) {
        eventData[key] = data[key];
      }
    }
  } else if (type === "merch") {
    const data = rest as { [key: string]: entry };
    const paidSchemaKeys = [
      "item_id",
      "item_email_desc",
      "item_image",
      "item_name",
      "item_price",
      "item_sales_active_utc",
      "limit_per_person",
      "member_price",
      "nonmember_price",
      "ready_for_pickup",
      "sizes",
      "total_avail",
    ];
    for (const key of paidSchemaKeys) {
      if (key in data) {
        paidData[key] = data[key];
      }
    }
    for (const key of eventSchemaKeys) {
      if (key in data) {
        eventData[key] = data[key];
      }
    }
  }
  return [type, eventData, paidData];
};

const eventsPlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.post<{ Body: EventPostRequest }>(
    "/:id?",
    {
      schema: {
        response: { 201: responseJsonSchema },
      },
      preValidation: async (request, reply) => {
        await fastify.zodValidateBody(request, reply, postRefinedSchema);
      },
      /*onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [AppRoles.EVENTS_MANAGER]);
      },*/
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
        const obj = splitter(request.body);
        const entry = {
          ...obj[1],
          id: entryUUID,
          createdBy: "request.username", //temporary disabled for testing
          createdAt: originalEvent
            ? originalEvent.createdAt || new Date().toISOString()
            : new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        console.log("PutEvent", entry);
        await fastify.dynamoClient.send(
          new PutItemCommand({
            TableName: genericConfig.EventsDynamoTableName,
            Item: marshall(entry),
          }),
        );

        switch (obj[0]) {
          case "ticket":
            const ticketEntry: z.infer<typeof postTicketEventSchema> = obj[2];
            const ticketResponse = await fastify.dynamoClient.send(
              new QueryCommand({
                TableName: genericConfig.TicketMetadataTableName,
                KeyConditionExpression: "event_id = :id",
                ExpressionAttributeValues: {
                  ":id": { S: ticketEntry.event_id },
                },
              }),
            );
            if (ticketResponse.Items?.length != 0) {
              throw new Error("Event_id already exists");
            }
            const ticketDBEntry = {
              ...ticketEntry,
              member_price: "Send to stripe API",
              nonmember_price: "Send to stripe API",
            };
            console.log("TicketPut", ticketDBEntry);
            await fastify.dynamoClient.send(
              new PutItemCommand({
                TableName: genericConfig.TicketMetadataTableName,
                Item: marshall(ticketDBEntry),
              }),
            );
            break;
          case "merch":
            const merchEntry: z.infer<typeof postMerchEventSchema> = obj[2];
            const merchResponse = await fastify.dynamoClient.send(
              new QueryCommand({
                TableName: genericConfig.MerchStoreMetadataTableName,
                KeyConditionExpression: "item_id = :id",
                ExpressionAttributeValues: {
                  ":id": { S: merchEntry.item_id },
                },
              }),
            );
            if (merchResponse.Items?.length != 0) {
              throw new Error("Item_id already exists");
            }
            const merchDBEntry = {
              ...merchEntry,
              member_price: "Send to stripe API",
              nonmember_price: "Send to stripe API",
            };
            await fastify.dynamoClient.send(
              new PutItemCommand({
                TableName: genericConfig.MerchStoreMetadataTableName,
                Item: marshall(merchDBEntry),
              }),
            );
            break;
        }

        let verb = "created";
        if (userProvidedId && userProvidedId === entryUUID) {
          verb = "modified";
        }
        /* Disable for now...
        try {
          if (eventEntry.featured && !eventEntry.repeats) {
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
        } */
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
          },
        },
        response: { 200: getEventsSchema },
      },
    },
    async (request: FastifyRequest<EventsGetRequest>, reply) => {
      const upcomingOnly = request.query?.upcomingOnly || false;
      const cachedResponse = fastify.nodeCache.get(
        `events-upcoming_only=${upcomingOnly}`,
      );
      if (cachedResponse) {
        return reply
          .header(
            "cache-control",
            "public, max-age=7200, stale-while-revalidate=900, stale-if-error=86400",
          )
          .header("acm-cache-status", "hit")
          .send(cachedResponse);
      }
      try {
        const response = await fastify.dynamoClient.send(
          new ScanCommand({ TableName: genericConfig.EventsDynamoTableName }),
        );
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
            "public, max-age=7200, stale-while-revalidate=900, stale-if-error=86400",
          )
          .header("acm-cache-status", "miss")
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
