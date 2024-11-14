import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { genericConfig } from "../config.js";
import {
  BaseError,
  DatabaseFetchError,
  NotFoundError,
  NotSupportedError,
  TicketNotFoundError,
  TicketNotValidError,
  UnauthenticatedError,
  ValidationError,
} from "../errors/index.js";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { validateEmail } from "../functions/validation.js";
import { AppRoles } from "../roles.js";
import { zodToJsonSchema } from "zod-to-json-schema";

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

const ticketInfoEntryZod = ticketEntryZod.extend({
  refunded: z.boolean(),
  fulfilled: z.boolean(),
});

type TicketEntry = z.infer<typeof ticketEntryZod>;
type TicketInfoEntry = z.infer<typeof ticketInfoEntryZod>;

const responseJsonSchema = zodToJsonSchema(ticketEntryZod);

const getTicketsResponseJsonSchema = zodToJsonSchema(
  z.object({
    tickets: z.array(ticketInfoEntryZod),
  }),
);

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

const listMerchItemsResponseJsonSchema = zodToJsonSchema(
  z.object({
    merch: z.array(baseItemMetadata),
    tickets: z.array(ticketingItemMetadata),
  }),
);

const postSchema = z.union([postMerchSchema, postTicketSchema]);

type VerifyPostRequest = z.infer<typeof postSchema>;

const dynamoClient = new DynamoDBClient({
  region: genericConfig.AwsRegion,
});

type TicketsGetRequest = {
  Params: { id: string };
  Querystring: { type: string };
  Body: undefined;
};

type TicketsListRequest = {
  Params: undefined;
  Querystring: undefined;
  Body: undefined;
};

const ticketsPlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.get<TicketsListRequest>(
    "/",
    {
      schema: {
        response: {
          200: listMerchItemsResponseJsonSchema,
        },
      },
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [AppRoles.TICKETS_MANAGER]);
      },
    },
    async (request, reply) => {
      const merchCommand = new ScanCommand({
        TableName: genericConfig.MerchStoreMetadataTableName,
        ProjectionExpression: "item_id, item_name, item_sales_active_utc",
      });
      const merchItems: ItemMetadata[] = [];
      const response = await dynamoClient.send(merchCommand);
      if (response.Items) {
        for (const item of response.Items.map((x) => unmarshall(x))) {
          const memberPrice = parseInt(item.item_price?.paid, 10) || 0;
          const nonMemberPrice = parseInt(item.item_price?.others, 10) || 0;
          merchItems.push({
            itemId: item.item_id,
            itemName: item.item_name,
            itemSalesActive:
              item.item_sales_active_utc === -1
                ? false
                : new Date(parseInt(item.item_sales_active_utc, 10)),
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
          "event_id, event_name, event_sales_active_utc, event_capacity, tickets_sold",
      });
      const ticketItems: TicketItemMetadata[] = [];
      const ticketResponse = await dynamoClient.send(ticketCommand);
      if (ticketResponse.Items) {
        for (const item of ticketResponse.Items.map((x) => unmarshall(x))) {
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
  fastify.get<TicketsGetRequest>(
    "/:eventId",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["merch", "ticket"],
            },
          },
        },
        response: {
          200: getTicketsResponseJsonSchema,
        },
      },
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [AppRoles.TICKETS_MANAGER]);
      },
    },
    async (request, reply) => {
      const eventId = (request.params as Record<string, string>).eventId;
      const eventType = request.query?.type;
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
          const response = await dynamoClient.send(command);
          if (!response.Items) {
            throw new NotFoundError({
              endpointName: `/api/v1/tickets/${eventId}`,
            });
          }
          for (const item of response.Items) {
            const unmarshalled = unmarshall(item);
            issuedTickets.push({
              type: "merch",
              valid: true,
              ticketId: unmarshalled["stripe_pi"],
              refunded: unmarshalled["refunded"],
              fulfilled: unmarshalled["fulfilled"],
              purchaserData: {
                email: unmarshalled["email"],
                productId: eventId,
                quantity: unmarshalled["quantity"],
                size: unmarshalled["size"],
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
  fastify.post<{ Body: VerifyPostRequest }>(
    "/checkIn",
    {
      schema: {
        response: { 200: responseJsonSchema },
      },
      preValidation: async (request, reply) => {
        await fastify.zodValidateBody(request, reply, postSchema);
      },
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [AppRoles.TICKETS_SCANNER]);
      },
    },
    async (request, reply) => {
      let command: UpdateItemCommand;
      let ticketId: string;
      if (!request.username) {
        throw new UnauthenticatedError({
          message: "Could not find username.",
        });
      }
      switch (request.body.type) {
        case "merch":
          ticketId = request.body.stripePi;
          command = new UpdateItemCommand({
            TableName: genericConfig.MerchStorePurchasesTableName,
            Key: {
              stripe_pi: { S: ticketId },
            },
            UpdateExpression: "SET fulfilled = :true_val",
            ConditionExpression: "#email = :email_val",
            ExpressionAttributeNames: {
              "#email": "email",
            },
            ExpressionAttributeValues: {
              ":true_val": { BOOL: true },
              ":email_val": { S: request.body.email },
            },
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
            UpdateExpression: "SET #used = :trueValue",
            ExpressionAttributeNames: {
              "#used": "used",
            },
            ExpressionAttributeValues: {
              ":trueValue": { BOOL: true },
            },
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
        const ticketEntry = await dynamoClient.send(command);
        if (!ticketEntry.Attributes) {
          throw new DatabaseFetchError({
            message: "Could not find ticket data",
          });
        }
        const attributes = unmarshall(ticketEntry.Attributes);
        if (attributes["refunded"]) {
          throw new TicketNotValidError({
            message: "Ticket was already refunded.",
          });
        }
        if (attributes["used"] || attributes["fulfilled"]) {
          throw new TicketNotValidError({
            message: "Ticket has already been used.",
          });
        }
        if (request.body.type === "ticket") {
          const rawData = attributes["ticketholder_netid"];
          const isEmail = validateEmail(attributes["ticketholder_netid"]);
          purchaserData = {
            email: isEmail ? rawData : `${rawData}@illinois.edu`,
            productId: attributes["event_id"],
            quantity: 1,
          };
        } else {
          purchaserData = {
            email: attributes["email"],
            productId: attributes["item_id"],
            quantity: attributes["quantity"],
            size: attributes["size"],
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
        if (e.name === "ConditionalCheckFailedException") {
          throw new TicketNotFoundError({
            message: "Ticket does not exist",
          });
        }
        throw new DatabaseFetchError({
          message: "Could not set ticket to used - database operation failed",
        });
      }
      const response = {
        valid: true,
        type: request.body.type,
        ticketId,
        purchaserData,
      };
      switch (request.body.type) {
        case "merch":
          ticketId = request.body.stripePi;
          command = new UpdateItemCommand({
            TableName: genericConfig.MerchStorePurchasesTableName,
            Key: {
              stripe_pi: { S: ticketId },
            },
            UpdateExpression:
              "SET scannerEmail = :scanner_email, scanISOTimestamp = :scan_time",
            ConditionExpression: "email = :email_val",
            ExpressionAttributeValues: {
              ":scanner_email": { S: request.username },
              ":scan_time": { S: new Date().toISOString() },
              ":email_val": { S: request.body.email },
            },
          });
          break;

        case "ticket":
          ticketId = request.body.ticketId;
          command = new UpdateItemCommand({
            TableName: genericConfig.TicketPurchasesTableName,
            Key: {
              ticket_id: { S: ticketId },
            },
            UpdateExpression:
              "SET scannerEmail = :scanner_email, scanISOTimestamp = :scan_time",
            ExpressionAttributeValues: {
              ":scanner_email": { S: request.username },
              ":scan_time": { S: new Date().toISOString() },
            },
          });
          break;

        default:
          throw new ValidationError({
            message: `Unknown verification type!`,
          });
      }
      await dynamoClient.send(command);
      reply.send(response);
    },
  );
};

export default ticketsPlugin;
