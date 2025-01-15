import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
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
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { genericConfig } from "../../common/config.js";
import { unmarshall } from "@aws-sdk/util-dynamodb";

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
        await fastify.authorize(request, reply, [
          AppRoles.LINKS_MANAGER,
          AppRoles.LINKS_ADMIN,
        ]);
      },
    },
    async (request, reply) => {
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
      // if an admin, show all links
      // if a links manager, show all my links + links I can manage

      try {
        const response = await dynamoClient.send(
          new ScanCommand({ TableName: genericConfig.LinkryDynamoTableName }),
        );
        const items = response.Items?.map((item) => unmarshall(item));
        console.log("Hello");
        console.log(items);

        // Sort items by createdAtUtc in ascending order, need to pass this to dyanmo instead of calcaulting here
        const sortedItems = items?.sort(
          (a, b) =>
            new Date(b.createdAtUtc).getTime() -
            new Date(a.createdAtUtc).getTime(),
        );
        console.log("World");
        console.log(items);

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
