import { FastifyPluginAsync } from "fastify";
import { unknown, z } from "zod";
import { AppRoles } from "../../common/roles.js";
import {
  BaseError,
  DatabaseFetchError,
  DatabaseInsertError,
  NotFoundError,
  NotImplementedError,
} from "../../common/errors/index.js";
import { intersection } from "../plugins/auth.js";
import { NoDataRequest } from "../types.js";
import {
  DynamoDBClient,
  QueryCommand,
  PutItemCommand,
  DeleteItemCommand,
  ScanCommand,
  GetItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { genericConfig } from "../../common/config.js";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { randomUUID } from "crypto";
import { access } from "fs";

const LINKRY_MAX_SLUG_LENGTH = 1000;

type LinkrySlugOnlyRequest = {
  Params: { slug: string };
  Querystring: undefined;
  Body: undefined;
};

const rawRequest = {
  slug: z.string().min(1),
  redirect: z.string().url().min(1),
  groups: z.optional(z.array(z.string()).min(1)),
};

const createRequest = z.object({
  slug: z.string().min(1).max(LINKRY_MAX_SLUG_LENGTH),
  access: z.array(z.string()).min(1),
  redirect: z.string().url().min(1),
});

const deleteRequest = z.object({
  slug: z.string().min(1),
  redirect: z.optional(z.string().url().min(1)),
  groups: z.optional(z.array(z.string()).min(1)),
});

const patchRequest = z.object({ redirect: z.string().url().min(1) });

type LinkyCreateRequest = {
  Params: undefined;
  Querystring: undefined;
  Body: z.infer<typeof createRequest>;
};

type LinkyDeleteRequest = {
  Params: undefined;
  Querystring: undefined;
  Body: z.infer<typeof deleteRequest>;
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
    const id = request.id;
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

        const routeAlreadyExists = fastify.hasRoute({
          url: `/${request.body.slug}`,
          method: "GET",
        });

        if (routeAlreadyExists) {
          //TODO: throw a more appropriate error type (and one that lets the end user see the message)?
          throw new DatabaseInsertError({
            message: `Slug ${request.body.slug} is reserved.`,
          });
        }

        for (const accessGroup of request.body.access) {
          if (
            !fastify.environmentConfig.LinkryGroupList.includes(accessGroup)
          ) {
            //TODO: throw a more appropriate error type (and one that lets the end user see the message)?
            throw new DatabaseInsertError({
              message: `${accessGroup} is not a valid access group.`,
            });
          }
        }

        //validate that the slug entry does not already exist
        //TODO: could this just call one of the other routes to prevent duplicating code?
        try {
          const queryParams = {
            TableName: genericConfig.LinkryDynamoTableName,
            KeyConditionExpression: "slug = :slug",
            ExpressionAttributeValues: {
              ":slug": { S: request.body.slug },
            },
          };

          const queryCommand = new QueryCommand(queryParams);
          const queryResponse = await dynamoClient.send(queryCommand);
          if (queryResponse.Items && queryResponse.Items.length > 0) {
            //TODO: throw a different error type so that the user can see the error message?
            throw new DatabaseInsertError({
              message: `Slug ${request.body.slug} already exists.`,
            });
          }
        } catch (e: unknown) {
          console.log(e);
          throw new DatabaseFetchError({
            message: "Failed to verify that the slug does not already exist.",
          });
        }
      },
      onRequest: async (request, reply) => {
        //TODO: re-add auth
        /*await fastify.authorize(request, reply, [
          AppRoles.LINKS_MANAGER,
          AppRoles.LINKS_ADMIN,
        ]);*/
        //Ethan: I took validation off for developing purposes
      },
    },
    async (request, reply) => {
      //Use a transaction to handle if one/multiple of these writes fail
      const TransactItems: object[] = [];

      try {
        //Add the OWNER record
        const creationTime: Date = new Date();
        const ownerRecord = {
          slug: request.body.slug,
          redirect: request.body.redirect,
          //TODO: FIXME: fix this, I don't know why request.username is now undefined
          access: "OWNER#" + request.username,
          updatedAtUtc: creationTime.toISOString(),
          createdAtUtc: creationTime.toISOString(),
        };
        const OwnerPutCommand = {
          Put: {
            TableName: genericConfig.LinkryDynamoTableName,
            Item: marshall(ownerRecord),
          },
        };

        TransactItems.push(OwnerPutCommand);

        //Add GROUP records
        const accessGroups: string[] = request.body.access;
        for (const accessGroup of accessGroups) {
          const groupRecord = {
            slug: request.body.slug,
            access: "GROUP#" + accessGroup,
          };
          const GroupPutCommand = {
            Put: {
              TableName: genericConfig.LinkryDynamoTableName,
              Item: marshall(groupRecord),
            },
          };

          TransactItems.push(GroupPutCommand);
        }

        await dynamoClient.send(
          new TransactWriteItemsCommand({ TransactItems: TransactItems }),
        );

        reply.send({ message: "Slug Created", id: request.body.slug });
      } catch (e: unknown) {
        console.log(e);
        throw new DatabaseInsertError({
          message: "Failed to create record in Dynamo table.",
        });
      }
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
    "/redir/:slug",
    {
      //no need of pre valiation, the route itself is prevalidating
      // preValidation: async (request, reply) => {
      //   await fastify.zodValidateBody(request, reply, deleteRequest);
      // },
      onRequest: async (request, reply) => {
        // await fastify.authorize(request, reply, [
        //   AppRoles.LINKS_MANAGER,
        //   AppRoles.LINKS_ADMIN,
        // ]);
      },
    },
    async (request, reply) => {
      const { slug: slug } = request.params;

      try {
        // Query to get all items with the specified slug
        const queryParams = {
          TableName: genericConfig.LinkryDynamoTableName, // Replace with your table name
          KeyConditionExpression: "slug = :slug",
          ExpressionAttributeValues: {
            ":slug": { S: decodeURIComponent(slug) },
          },
        };

        const queryCommand = new QueryCommand(queryParams);
        const queryResponse = await dynamoClient.send(queryCommand);

        const items = queryResponse.Items || [];

        const desiredAccessValues = fastify.environmentConfig.LinkryGroupList;

        //Use the below fastify environement to fetch group names
        //console.log(desiredAccessValues)

        const filteredItems = items.filter((item) => {
          if (item.access.S?.startsWith("OWNER#")) {
            return true;
          } //Ethan: temporary solution, current filter deletes all owner tagged and group tagged, need to differentiate between deleting owner versus deleting specific groups...
          else {
            return (
              item.access.S &&
              desiredAccessValues.includes(item.access.S.replace("GROUP#", ""))
            );
          }
        });

        // Delete all fetched items
        const deletePromises = (filteredItems || []).map((item) =>
          dynamoClient.send(
            new DeleteItemCommand({
              TableName: genericConfig.LinkryDynamoTableName,
              Key: { slug: item.slug, access: item.access },
            }),
          ),
        );

        await Promise.all(deletePromises);

        reply.code(200).send({
          message: `All records with slug '${slug}' deleted successfully`,
        });
      } catch (error) {
        console.error("Error deleting records:", error);
        reply.code(500).send({ error: "Failed to delete records" });
      }
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
    },
  );
};

export default linkryRoutes;
