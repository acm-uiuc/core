import { FastifyPluginAsync } from "fastify";
import rateLimiter from "api/plugins/rateLimiter.js";
import { withRoles, withTags } from "api/components/index.js";
import { QueryCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";
import {
  DatabaseFetchError,
  UnauthenticatedError,
  UnauthorizedError,
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
      const putCommand = new PutItemCommand({
        TableName: genericConfig.RSVPDynamoTableName,
        Item: marshall(entry),
      });
      await fastify.dynamoClient.send(putCommand);
      return reply.status(201).send(entry);
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
};

export default rsvpRoutes;
