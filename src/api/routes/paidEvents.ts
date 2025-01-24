import { FastifyPluginAsync, FastifyRequest } from "fastify";
import {
  DynamoDBClient,
  UpdateItemCommand,
  QueryCommand,
  ScanCommand,
  ConditionalCheckFailedException,
  PutItemCommand,
  DeleteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { genericConfig } from "../../common/config.js";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { DatabaseFetchError } from "../../common/errors/index.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { AppRoles } from "../../common/roles.js";

const dynamoclient = new DynamoDBClient({
  region: genericConfig.AwsRegion,
});

type EventGetRequest = {
  Params: { id: string };
  Querystring: undefined;
  Body: undefined;
};

type EventUpdateRequest = {
  Params: { id: string };
  Querystring: undefined;
  Body: { attribute: string; value: string };
};

type EventDeleteRequest = {
  Params: { id: string };
  Querystring: undefined;
  Body: undefined;
};

const TicketPostSchema = z.object({
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

const MerchPostSchema = z.object({
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

type TicketPostSchema = z.infer<typeof TicketPostSchema>;
type MerchPostSchema = z.infer<typeof MerchPostSchema>;

const responseJsonSchema = zodToJsonSchema(
  z.object({
    id: z.string(),
    resource: z.string(),
  }),
);

const paidEventsPlugin: FastifyPluginAsync = async (fastify, _options) => {
  //Healthz
  fastify.get("/", (request, reply) => {
    reply.send({ Status: "Up" });
  });

  
  fastify.get("/ticketEvents", async (request, reply) => {
    try {
      const response = await dynamoclient.send(
        new ScanCommand({
          TableName: genericConfig.TicketMetadataTableName,
        }),
      );
      const items = response.Items?.map((item) => unmarshall(item));
      reply
        .header(
          "cache-control",
          "public, max-age=7200, stale-while-revalidate=900, stale-if-error=86400",
        )
        .send(items);
    } catch (e: unknown) {
      if (e instanceof Error) {
        request.log.error("Failed" + e.toString());
      } else {
        request.log.error(`Failed to get from DynamoDB. ${e}`);
      }
      throw new DatabaseFetchError({
        message: "Failed to get events from Dynamo table.",
      });
    }
  });

  fastify.get("/merchEvents", async (request, reply) => {
    try {
      const response = await dynamoclient.send(
        new ScanCommand({
          TableName: genericConfig.MerchStoreMetadataTableName,
        }),
      );
      const items = response.Items?.map((item) => unmarshall(item));
      reply
        .header(
          "cache-control",
          "public, max-age=7200, stale-while-revalidate=900, stale-if-error=86400",
        )
        .send(items);
    } catch (e: unknown) {
      if (e instanceof Error) {
        request.log.error("Failed" + e.toString());
      } else {
        request.log.error(`Failed to get from DynamoDB. ${e}`);
      }
      throw new DatabaseFetchError({
        message: "Failed to get events from Dynamo table.",
      });
    }
  });

  fastify.get<EventGetRequest>(
    "/ticketEvents/:id",
    async (request: FastifyRequest<EventGetRequest>, reply) => {
      const id = request.params.id;
      try {
        const response = await dynamoclient.send(
          new QueryCommand({
            TableName: genericConfig.TicketMetadataTableName,
            KeyConditionExpression: "event_id = :id",
            ExpressionAttributeValues: {
              ":id": { S: id },
            },
          }),
        );
        const items = response.Items?.map((item) => unmarshall(item));
        if (items?.length !== 1) {
          throw new Error("Event not found");
        }
        reply.send(items[0]);
      } catch (e: unknown) {
        if (e instanceof Error) {
          request.log.error("Failed to get from DynamoDB: " + e.toString());
        }
        throw new DatabaseFetchError({
          message: "Failed to get event from Dynamo table.",
        });
      }
    },
  );

  //Get merchEvents by id
  fastify.get<EventGetRequest>(
    "/merchEvents/:id",
    async (request: FastifyRequest<EventGetRequest>, reply) => {
      const id = request.params.id;
      try {
        const response = await dynamoclient.send(
          new QueryCommand({
            TableName: genericConfig.MerchStoreMetadataTableName,
            KeyConditionExpression: "item_id = :id",
            ExpressionAttributeValues: {
              ":id": { S: id },
            },
          }),
        );
        const items = response.Items?.map((item) => unmarshall(item));
        if (items?.length !== 1) {
          throw new Error("Event not found");
        }
        reply.send(items[0]);
      } catch (e: unknown) {
        if (e instanceof Error) {
          request.log.error("Failed to get from DynamoDB: " + e.toString());
        }
        throw new DatabaseFetchError({
          message: "Failed to get event from Dynamo table.",
        });
      }
    },
  );

  //Update ticketEvents by id
  fastify.put<EventUpdateRequest>(
    "/ticketEvents/:id",
    {
      schema: {
        response: { 200: responseJsonSchema },
      },
      /*onRequest: async (request, reply) => {
            await fastify.authorize(request, reply, [AppRoles.EVENTS_MANAGER]);
          },*/ //Validation taken off for testing
    },
    async (request: FastifyRequest<EventUpdateRequest>, reply) => {
      try {
        const id = request.params.id;
        const attribute = request.body.attribute;
        const value = request.body.value;

        let valueExpression;
        const temp = Number(value);
        if (isNaN(temp)) {
          valueExpression = { S: value };
        } else {
          valueExpression = { N: value };
        }

        const _response = await dynamoclient.send(
          new UpdateItemCommand({
            TableName: genericConfig.TicketMetadataTableName,
            Key: {
              event_id: { S: id },
            },
            ConditionExpression: "attribute_exists(#attr)",
            UpdateExpression: "SET #attr = :value",
            ExpressionAttributeNames: {
              "#attr": attribute,
            },
            ExpressionAttributeValues: {
              ":value": valueExpression,
            },
          }),
        );
        reply.send({
          id: id,
          resource: `/api/v1/paidEvents/ticketEvents/${id}`,
        });
      } catch (e: unknown) {
        if (e instanceof Error) {
          request.log.error("Failed to update to DynamoDB: " + e.toString());
        }
        if (e instanceof ConditionalCheckFailedException) {
          request.log.error("Attribute does not exist");
        }
        throw new DatabaseFetchError({
          message: "Failed to update event in Dynamo table.",
        });
      }
    },
  );

  //Update merchEvents by id
  fastify.put<EventUpdateRequest>(
    "/merchEvents/:id",
    {
      schema: {
        response: { 200: responseJsonSchema },
      },
      /*onRequest: async (request, reply) => {
            await fastify.authorize(request, reply, [AppRoles.EVENTS_MANAGER]);
          },*/ //Validatison taken off for testing
    },
    async (request: FastifyRequest<EventUpdateRequest>, reply) => {
      try {
        const id = request.params.id;
        const attribute = request.body.attribute;
        const value = request.body.value;

        let valueExpression;
        const num = Number(value);
        if (isNaN(num)) {
          valueExpression = { S: value };
        } else {
          valueExpression = { N: value };
        }

        const _response = await dynamoclient.send(
          new UpdateItemCommand({
            TableName: genericConfig.MerchStoreMetadataTableName,
            Key: {
              item_id: { S: id },
            },
            ConditionExpression: "attribute_exists(#attr)",
            UpdateExpression: "SET #attr = :value",
            ExpressionAttributeNames: {
              "#attr": attribute,
            },
            ExpressionAttributeValues: {
              ":value": valueExpression,
            },
          }),
        );
        reply.send({
          id: id,
          resource: `/api/v1/paidEvents/merchEvents/${id}`,
        });
      } catch (e: unknown) {
        if (e instanceof Error) {
          request.log.error("Failed to update to DynamoDB: " + e.toString());
        }
        if (e instanceof ConditionalCheckFailedException) {
          request.log.error("Attribute does not exist");
        }
        throw new DatabaseFetchError({
          message: "Failed to update event in Dynamo table.",
        });
      }
    },
  );

  //Post ticketEvents
  fastify.post<{ Body: TicketPostSchema }>(
    "/ticketEvents",
    {
      schema: {
        response: { 200: responseJsonSchema },
      },
      preValidation: async (request, reply) => {
        await fastify.zodValidateBody(request, reply, TicketPostSchema);
      },
      /*onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [AppRoles.EVENTS_MANAGER]);
      },*/ //validation taken off
    },
    async (request: FastifyRequest<{ Body: TicketPostSchema }>, reply) => {
      const id = request.body.event_id;
      try {
        //Verify if event_id already exists
        const response = await dynamoclient.send(
          new QueryCommand({
            TableName: genericConfig.TicketMetadataTableName,
            KeyConditionExpression: "event_id = :id",
            ExpressionAttributeValues: {
              ":id": { S: id },
            },
          }),
        );
        if (response.Items?.length != 0) {
          throw new Error("Event_id already exists");
        }
        const entry = {
          ...request.body,
          member_price: "Send to stripe API",
          nonmember_price: "Send to stripe API",
        };
        await dynamoclient.send(
          new PutItemCommand({
            TableName: genericConfig.TicketMetadataTableName,
            Item: marshall(entry),
          }),
        );
        reply.send({
          id: id,
          resource: `/api/v1/paidEvents/ticketEvents/${id}`,
        });
      } catch (e: unknown) {
        if (e instanceof Error) {
          request.log.error("Failed to post to DynamoDB: " + e.toString());
        }
        throw new DatabaseFetchError({
          message: "Failed to post event to Dynamo table.",
        });
      }
    },
  );


  //Post merchEvents
  fastify.post<{ Body: MerchPostSchema }>(
    "/merchEvents",
    {
      schema: {
        response: { 200: responseJsonSchema },
      },
      preValidation: async (request, reply) => {
        await fastify.zodValidateBody(request, reply, MerchPostSchema);
      },
      /*onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [AppRoles.EVENTS_MANAGER]);
      },*/ //validation taken off
    },
    async (request: FastifyRequest<{ Body: MerchPostSchema }>, reply) => {
      const id = request.body.item_id;
      try {
        //Verify if item_id already exists
        const response = await dynamoclient.send(
          new QueryCommand({
            TableName: genericConfig.TicketMetadataTableName,
            KeyConditionExpression: "item_id = :id",
            ExpressionAttributeValues: {
              ":id": { S: id },
            },
          }),
        );
        if (response.Items?.length != 0) {
          throw new Error("Item_id already exists");
        }
        const entry = {
          ...request.body,
          member_price: "Send to stripe API",
          nonmember_price: "Send to stripe API",
        };
        await dynamoclient.send(
          new PutItemCommand({
            TableName: genericConfig.TicketMetadataTableName,
            Item: marshall(entry),
          }),
        );
        reply.send({
          id: id,
          resource: `/api/v1/paidEvents/merchEvents/${id}`,
        });
      } catch (e: unknown) {
        if (e instanceof Error) {
          request.log.error("Failed to post to DynamoDB: " + e.toString());
        }
        throw new DatabaseFetchError({
          message: "Failed to post event to Dynamo table.",
        });
      }
    },
  );



  fastify.delete<EventDeleteRequest>(
    "/ticketEvents/:id",
    {
      schema: {
        response: { 200: responseJsonSchema },
      },
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [AppRoles.EVENTS_MANAGER]);
      }, //auth
    },
    async (request: FastifyRequest<EventDeleteRequest>, reply) => {
      const id = request.params.id;
      try {
        await dynamoclient.send(
          new DeleteItemCommand({
            TableName: genericConfig.TicketMetadataTableName,
            Key: {
              event_id: { S: id },
            },
          }),
        );
        reply.send({
          id: id,
          resource: `/api/v1/paidEvents/ticketEvents/${id}`,
        });
      } catch (e: unknown) {
        if (e instanceof Error) {
          request.log.error("Failed to delete from DynamoDB: " + e.toString());
        }
        throw new DatabaseFetchError({
          message: "Failed to delete event from Dynamo table.",
        });
      }
    },
  );
};

export default paidEventsPlugin;
