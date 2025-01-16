import { FastifyPluginAsync } from "fastify";
import { unknown, z } from "zod";
import { AppRoles } from "../../common/roles.js";
import {
  BaseError,
  DatabaseFetchError,
  NotFoundError,
  NotImplementedError,
} from "../../common/errors/index.js";
import { intersection } from "../plugins/auth.js";
import { NoDataRequest } from "../types.js";
import {
  DynamoDBClient,
  QueryCommand,
  PutItemCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { genericConfig } from "../../common/config.js";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { randomUUID } from "crypto";

type LinkrySlugOnlyRequest = {
  Params: { id: string };
  Querystring: undefined;
  Body: undefined;
};

const rawRequest = {
  slug: z.string().min(1),
  redirect: z.string().url().min(1),
  groups: z.optional(z.array(z.string()).min(1)),
};

const createRequest = z.object(rawRequest);
const patchRequest = z.object({ redirect: z.string().url().min(1) });

type LinkyCreateRequest = {
  Params: undefined;
  Querystring: undefined;
  Body: z.infer<typeof createRequest>;
};

type LinkryPatchRequest = {
  Params: { id: string };
  Querystring: undefined;
  Body: z.infer<typeof patchRequest>;
};

const dynamoClient = new DynamoDBClient({
  region: genericConfig.AwsRegion,
});

const linkryRoutes: FastifyPluginAsync = async (fastify, _options) => {
  fastify.get<LinkrySlugOnlyRequest>("/redir/:id", async (request, reply) => {
    const id = request.params.id;
    const command = new QueryCommand({
      TableName: genericConfig.LinkryDynamoTableName,
      KeyConditionExpression:
        "#slug = :slugVal AND begins_with(#access, :accessVal)",
      ExpressionAttributeNames: {
        "#slug": "slug",
        "#access": "access",
      },
      ExpressionAttributeValues: {
        ":slugVal": { S: id },
        ":accessVal": { S: "OWNER#" },
      },
    });
    try {
      const result = await dynamoClient.send(command);
      if (!result || !result.Items || result.Items.length === 0) {
        return reply
          .headers({ "content-type": "text/html" })
          .status(404)
          .sendFile("404.html");
      }
      return reply.redirect(unmarshall(result.Items[0]).redirect);
    } catch (e) {
      if (e instanceof BaseError) {
        throw e;
      }
      request.log.error(e);
      throw new DatabaseFetchError({
        message: "Could not retrieve mapping, please try again later.",
      });
    }
  });
  fastify.post<LinkyCreateRequest>(
    "/redir",
    {
      preValidation: async (request, reply) => {
        await fastify.zodValidateBody(request, reply, createRequest);
      },
      onRequest: async (request, reply) => {
        // await fastify.authorize(request, reply, [
        //   AppRoles.LINKS_MANAGER,
        //   AppRoles.LINKS_ADMIN,
        // ]);
        //send a request to database to add a new linkry record
      },
    },
    async (request, reply) => {
      try {
        const entry = {
          slug: request.body.slug,
          redirect: request.body.redirect,
          access: "OWNER#testUser",
          UpdatedAtUtc: Date.now(),
          createdAtUtc: Date.now(),
        };
        await dynamoClient.send(
          new PutItemCommand({
            TableName: genericConfig.LinkryDynamoTableName,
            Item: marshall(entry),
          }),
        );
        reply.send({ message: "Record Created" });
      } catch (e: unknown) {
        console.log(e);
        throw new DatabaseFetchError({
          message: "Failed to create record in Dynamo table.",
        });
      }
      throw new NotImplementedError({});
    },
  );
  fastify.patch<LinkryPatchRequest>(
    "/redir/:id",
    {
      preValidation: async (request, reply) => {
        await fastify.zodValidateBody(request, reply, patchRequest);
      },
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [
          AppRoles.LINKS_MANAGER,
          AppRoles.LINKS_ADMIN,
        ]);
      },
    },
    async (request, reply) => {
      // make sure that a user can manage this link, either via owning or being in a group that has access to it, or is a LINKS_ADMIN.
      // you can only change the URL it redirects to
      throw new NotImplementedError({});
    },
  );
  fastify.delete<LinkrySlugOnlyRequest>(
    "/redir/:id",
    {
      preValidation: async (request, reply) => {
        await fastify.zodValidateBody(request, reply, createRequest);
      },
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [
          AppRoles.LINKS_MANAGER,
          AppRoles.LINKS_ADMIN,
        ]);
      },
    },
    async (request, reply) => {
      // make sure that a user can manage this link, either via owning or being in a group that has access to it, or is a LINKS_ADMIN.
      throw new NotImplementedError({});
    },
  );
  fastify.get<NoDataRequest>(
    "/redir",
    // {
    //   onRequest: async (request, reply) => {
    //     await fastify.authorize(request, reply, [
    //       AppRoles.LINKS_MANAGER,
    //       AppRoles.LINKS_ADMIN,
    //     ]);
    //   },
    // },
    async (request, reply) => {
      // console.log("******#*#")
      // console.log(request.headers)
      // if an admin, show all links
      // if a links manager, show all my links + links I can manage

      try {
        const response = await dynamoClient.send(
          new ScanCommand({ TableName: genericConfig.LinkryDynamoTableName }),
        );
        const items = response.Items?.map((item) => unmarshall(item));

        // Sort items by createdAtUtc in ascending order, need to pass this to dyanmo instead of calcaulting here
        const sortedItems = items?.sort(
          (a, b) =>
            new Date(b.createdAtUtc).getTime() -
            new Date(a.createdAtUtc).getTime(),
        );

        // Check for the desired condition and respond
        if (sortedItems?.length === 0) {
          throw new Error("No Links Found");
        }

        reply.send(sortedItems);
      } catch (e) {
        if (e instanceof Error) {
          request.log.error("Failed to get from DynamoDB: " + e.toString());
        }
        console.log(e);
        throw new DatabaseFetchError({
          message: "Failed to get Links from Dynamo table.",
        });
      }

      throw new NotImplementedError({});
    },
  );
};

export default linkryRoutes;
