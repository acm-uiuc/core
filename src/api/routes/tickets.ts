import { FastifyPluginAsync } from "fastify";
import * as z from "zod/v4";
import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { genericConfig } from "../../common/config.js";
import {
  BaseError,
  DatabaseFetchError,
  DatabaseInsertError,
  NotFoundError,
  NotSupportedError,
  TicketNotFoundError,
  TicketNotValidError,
  UnauthenticatedError,
  ValidationError,
} from "../../common/errors/index.js";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { validateEmail } from "../functions/validation.js";
import { AppRoles } from "../../common/roles.js";
import { postMetadataSchema } from "common/types/tickets.js";
import { createAuditLogEntry } from "api/functions/auditLog.js";
import { Modules } from "common/modules.js";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import { withRoles, withTags } from "api/components/index.js";
import { FULFILLED_PURCHASES_RETENTION_DAYS } from "common/constants.js";
import {
  getUserMerchPurchases,
  getUserTicketingPurchases,
} from "api/functions/tickets.js";

const postMerchSchema = z.object({
  type: z.literal("merch"),
  email: z.string().email(),
  stripePi: z.string().min(1),
});

const postTicketSchema = z.object({
  type: z.literal("ticket"),
  ticketId: z.string().min(1),
});

const purchaseSchema = z.object({
  email: z.string().email(),
  productId: z.string(),
  quantity: z.number().int().positive(),
  size: z.string().optional(),
});

type PurchaseData = z.infer<typeof purchaseSchema>;

const ticketEntryZod = z.object({
  valid: z.boolean(),
  type: z.enum(["merch", "ticket"]),
  ticketId: z.string().min(1),
  purchaserData: purchaseSchema,
});

const ticketInfoEntryZod = ticketEntryZod
  .extend({
    refunded: z.boolean(),
    fulfilled: z.boolean(),
  })
  .meta({
    description: "An entry describing one merch or tickets transaction.",
  });

export type TicketInfoEntry = z.infer<typeof ticketInfoEntryZod>;

const baseItemMetadata = z.object({
  itemId: z.string().min(1),
  itemName: z.string().min(1),
  itemSalesActive: z.union([z.date(), z.literal(false)]),
  priceDollars: z.object({
    member: z.number().min(0),
    nonMember: z.number().min(0),
  }),
});

const ticketingItemMetadata = baseItemMetadata.extend({
  eventCapacity: z.number(),
  ticketsSold: z.number(),
});

type ItemMetadata = z.infer<typeof baseItemMetadata>;
type TicketItemMetadata = z.infer<typeof ticketingItemMetadata>;

const postSchema = z.union([postMerchSchema, postTicketSchema]);

const ticketsPlugin: FastifyPluginAsync = async (fastify, _options) => {
  // tickets is legacy and is stuck in us-east-1 for now.
  const UsEast1DynamoClient = new DynamoDBClient({
    region: "us-east-1",
  });
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "",
    {
      schema: withRoles(
        [AppRoles.TICKETS_MANAGER, AppRoles.TICKETS_SCANNER],
        withTags(["Tickets/Merchandise"], {
          summary: "Retrieve metadata about tickets/merchandise items.",
          response: {
            200: {
              description: "The available items were retrieved.",
              content: {
                "application/json": {
                  schema: z.object({
                    merch: z.array(baseItemMetadata),
                    tickets: z.array(ticketingItemMetadata),
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
      let isTicketingManager = true;
      try {
        await fastify.authorize(
          request,
          reply,
          [AppRoles.TICKETS_MANAGER],
          false,
        );
      } catch {
        isTicketingManager = false;
      }

      const merchCommand = new ScanCommand({
        TableName: genericConfig.MerchStoreMetadataTableName,
        ProjectionExpression:
          "item_id, item_name, item_sales_active_utc, item_price",
      });

      const merchItems: ItemMetadata[] = [];
      const response = await UsEast1DynamoClient.send(merchCommand);
      const now = new Date();

      if (response.Items) {
        for (const item of response.Items.map((x) => unmarshall(x))) {
          const itemDate = new Date(parseInt(item.item_sales_active_utc, 10));
          if (
            !isTicketingManager &&
            (item.item_sales_active_utc === -1 || itemDate > now)
          ) {
            continue;
          }

          const memberPrice = parseInt(item.item_price?.paid, 10) || 0;
          const nonMemberPrice = parseInt(item.item_price?.others, 10) || 0;
          merchItems.push({
            itemId: item.item_id,
            itemName: item.item_name,
            itemSalesActive:
              item.item_sales_active_utc === -1 ? false : itemDate,
            priceDollars: {
              member: memberPrice,
              nonMember: nonMemberPrice,
            },
          });
        }
      }

      const ticketCommand = new ScanCommand({
        TableName: genericConfig.TicketMetadataTableName,
        ProjectionExpression:
          "event_id, event_name, event_sales_active_utc, event_capacity, tickets_sold, eventCost",
      });

      const ticketItems: TicketItemMetadata[] = [];
      const ticketResponse = await UsEast1DynamoClient.send(ticketCommand);

      if (ticketResponse.Items) {
        for (const item of ticketResponse.Items.map((x) => unmarshall(x))) {
          const itemDate = new Date(parseInt(item.event_sales_active_utc, 10));
          if (
            !isTicketingManager &&
            (item.event_sales_active_utc === -1 || itemDate > now)
          ) {
            continue;
          }
          const memberPrice = parseInt(item.eventCost?.paid, 10) || 0;
          const nonMemberPrice = parseInt(item.eventCost?.others, 10) || 0;
          ticketItems.push({
            itemId: item.event_id,
            itemName: item.event_name,
            itemSalesActive:
              item.event_sales_active_utc === -1
                ? false
                : new Date(parseInt(item.event_sales_active_utc, 10)),
            eventCapacity: item.event_capacity,
            ticketsSold: item.tickets_sold,
            priceDollars: {
              member: memberPrice,
              nonMember: nonMemberPrice,
            },
          });
        }
      }
      reply.send({ merch: merchItems, tickets: ticketItems });
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/event/:eventId",
    {
      schema: withRoles(
        [AppRoles.TICKETS_MANAGER],
        withTags(["Tickets/Merchandise"], {
          summary: "Get detailed per-sale information by event ID.",
          querystring: z.object({
            type: z.enum(["merch", "ticket"]),
          }),
          params: z.object({
            eventId: z.string().min(1),
          }),
          response: {
            200: {
              description: "All issued tickets for this event were retrieved.",
              content: {
                "application/json": {
                  schema: z.object({
                    tickets: z.array(ticketInfoEntryZod),
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
      const eventId = request.params.eventId;
      const eventType = request.query.type;
      const issuedTickets: TicketInfoEntry[] = [];
      switch (eventType) {
        case "merch":
          const command = new QueryCommand({
            TableName: genericConfig.MerchStorePurchasesTableName,
            IndexName: "ItemIdIndexAll",
            KeyConditionExpression: "item_id = :itemId",
            ExpressionAttributeValues: {
              ":itemId": { S: eventId },
            },
          });
          const response = await UsEast1DynamoClient.send(command);
          if (!response.Items) {
            throw new NotFoundError({
              endpointName: request.url,
            });
          }
          for (const item of response.Items) {
            const unmarshalled = unmarshall(item);
            issuedTickets.push({
              type: "merch",
              valid: true,
              ticketId: unmarshalled.stripe_pi,
              refunded: unmarshalled.refunded,
              fulfilled: unmarshalled.fulfilled,
              purchaserData: {
                email: unmarshalled.email,
                productId: eventId,
                quantity: unmarshalled.quantity,
                size: unmarshalled.size,
              },
            });
          }
          break;
        default:
          throw new NotSupportedError({
            message: `Retrieving tickets currently only supported on type "merch"!`,
          });
      }
      const response = { tickets: issuedTickets };
      return reply.send(response);
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().patch(
    "/:eventId",
    {
      schema: withRoles(
        [AppRoles.TICKETS_MANAGER],
        withTags(["Tickets/Merchandise"], {
          summary: "Modify event metadata.",
          params: z.object({
            eventId: z.string().min(1),
          }),
          body: postMetadataSchema,
          response: {
            201: {
              description: "The item has been modified.",
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
      const eventId = request.params.eventId;
      const eventType = request.body.type;
      const eventActiveSet = request.body.itemSalesActive;
      let newActiveTime: number = 0;
      if (typeof eventActiveSet === "boolean") {
        if (!eventActiveSet) {
          newActiveTime = -1;
        }
      } else {
        newActiveTime = parseInt(
          (eventActiveSet.valueOf() / 1000).toFixed(0),
          10,
        );
      }
      let command: UpdateItemCommand;
      switch (eventType) {
        case "merch":
          command = new UpdateItemCommand({
            TableName: genericConfig.MerchStoreMetadataTableName,
            Key: marshall({ item_id: eventId }),
            UpdateExpression: "SET item_sales_active_utc = :new_val",
            ConditionExpression: "item_id = :item_id",
            ExpressionAttributeValues: {
              ":new_val": { N: newActiveTime.toString() },
              ":item_id": { S: eventId },
            },
          });
          break;
        case "ticket":
          command = new UpdateItemCommand({
            TableName: genericConfig.TicketMetadataTableName,
            Key: marshall({ event_id: eventId }),
            UpdateExpression: "SET event_sales_active_utc = :new_val",
            ConditionExpression: "event_id = :item_id",
            ExpressionAttributeValues: {
              ":new_val": { N: newActiveTime.toString() },
              ":item_id": { S: eventId },
            },
          });
          break;
      }
      try {
        await UsEast1DynamoClient.send(command);
      } catch (e) {
        if (e instanceof ConditionalCheckFailedException) {
          throw new NotFoundError({
            endpointName: request.url,
          });
        }
        fastify.log.error(e);
        throw new DatabaseInsertError({
          message: "Could not update active time for item.",
        });
      }
      return reply.status(201).send();
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/checkIn",
    {
      schema: withRoles(
        [AppRoles.TICKETS_SCANNER],
        withTags(["Tickets/Merchandise"], {
          summary: "Mark a ticket/merch item as fulfilled by QR code data.",
          body: postSchema,
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      let command: UpdateItemCommand;
      let ticketId: string;
      if (!request.username) {
        throw new UnauthenticatedError({
          message: "Could not find username.",
        });
      }
      const expiresAt =
        Math.floor(Date.now() / 1000) +
        86400 * FULFILLED_PURCHASES_RETENTION_DAYS;
      switch (request.body.type) {
        case "merch":
          ticketId = request.body.stripePi;
          command = new UpdateItemCommand({
            TableName: genericConfig.MerchStorePurchasesTableName,
            Key: {
              stripe_pi: { S: ticketId },
            },
            UpdateExpression: "SET fulfilled = :true_val, expiresAt = :ttl",
            ConditionExpression:
              "#email = :email_val AND (attribute_not_exists(fulfilled) OR fulfilled = :false_val) AND (attribute_not_exists(refunded) OR refunded = :false_val)",
            ExpressionAttributeNames: {
              "#email": "email",
            },
            ExpressionAttributeValues: {
              ":true_val": { BOOL: true },
              ":false_val": { BOOL: false },
              ":email_val": { S: request.body.email },
              ":ttl": { N: expiresAt.toString() },
            },
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
            ReturnValues: "ALL_OLD",
          });
          break;
        case "ticket":
          ticketId = request.body.ticketId;
          command = new UpdateItemCommand({
            TableName: genericConfig.TicketPurchasesTableName,
            Key: {
              ticket_id: { S: ticketId },
            },
            UpdateExpression: "SET #used = :trueValue, expiresAt = :ttl",
            ConditionExpression:
              "(attribute_not_exists(#used) OR #used = :falseValue) AND (attribute_not_exists(refunded) OR refunded = :falseValue)",
            ExpressionAttributeNames: {
              "#used": "used",
            },
            ExpressionAttributeValues: {
              ":trueValue": { BOOL: true },
              ":falseValue": { BOOL: false },
              ":ttl": { N: expiresAt.toString() },
            },
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
            ReturnValues: "ALL_OLD",
          });
          break;
        default:
          throw new ValidationError({
            message: `Unknown verification type!`,
          });
      }
      let purchaserData: PurchaseData;
      try {
        const ticketEntry = await UsEast1DynamoClient.send(command);
        if (!ticketEntry.Attributes) {
          throw new DatabaseFetchError({
            message: "Could not find ticket data",
          });
        }
        const attributes = unmarshall(ticketEntry.Attributes);
        if (request.body.type === "ticket") {
          const rawData = attributes.ticketholder_netid;
          const isEmail = validateEmail(attributes.ticketholder_netid);
          purchaserData = {
            email: isEmail ? rawData : `${rawData}@illinois.edu`,
            productId: attributes.event_id,
            quantity: 1,
          };
        } else {
          purchaserData = {
            email: attributes.email,
            productId: attributes.item_id,
            quantity: attributes.quantity,
            size: attributes.size,
          };
        }
      } catch (e: unknown) {
        if (!(e instanceof Error)) {
          throw e;
        }
        request.log.error(e);
        if (e instanceof BaseError) {
          throw e;
        }
        if (e instanceof ConditionalCheckFailedException) {
          if (e.Item) {
            const unmarshalled = unmarshall(e.Item);
            if (unmarshalled.fulfilled || unmarshalled.used) {
              throw new TicketNotValidError({
                message: "Ticket has already been used.",
              });
            }
            if (unmarshalled.refunded) {
              throw new TicketNotValidError({
                message: "Ticket was already refunded.",
              });
            }
          }
          throw new TicketNotFoundError({
            message: "Ticket does not exist.",
          });
        }
        throw new DatabaseFetchError({
          message: "Could not set ticket to used - database operation failed",
        });
      }
      reply.send({
        valid: true,
        type: request.body.type,
        ticketId,
        purchaserData,
      });
      await createAuditLogEntry({
        dynamoClient: UsEast1DynamoClient,
        entry: {
          module: Modules.TICKETS,
          actor: request.username!,
          target: ticketId,
          message: `checked in ticket of type "${request.body.type}" ${request.body.type === "merch" ? `purchased by email ${request.body.email}.` : "."}`,
          requestId: request.id,
        },
      });
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/purchases/:email",
    {
      schema: withRoles(
        [AppRoles.TICKETS_MANAGER, AppRoles.TICKETS_SCANNER],
        withTags(["Tickets/Merchandise"], {
          summary: "Get all purchases (merch and tickets) for a given user.",
          params: z.object({
            email: z.email(),
          }),
          response: {
            200: {
              description: "The user's purchases were retrieved.",
              content: {
                "application/json": {
                  schema: z.object({
                    merch: z.array(ticketInfoEntryZod),
                    tickets: z.array(ticketInfoEntryZod),
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
      const userEmail = request.params.email;
      try {
        const [ticketsResult, merchResult] = await Promise.all([
          getUserTicketingPurchases({
            dynamoClient: UsEast1DynamoClient,
            email: userEmail,
            logger: request.log,
          }),
          getUserMerchPurchases({
            dynamoClient: UsEast1DynamoClient,
            email: userEmail,
            logger: request.log,
          }),
        ]);
        await reply.send({ merch: merchResult, tickets: ticketsResult });
      } catch (e) {
        if (e instanceof BaseError) {
          throw e;
        }
        request.log.error(e);
        throw new DatabaseFetchError({
          message: "Failed to get user purchases.",
        });
      }
    },
  );
};

export default ticketsPlugin;
