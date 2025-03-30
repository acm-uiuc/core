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
  UpdateItemCommand,
  AttributeValue,
} from "@aws-sdk/client-dynamodb";
import { genericConfig } from "../../common/config.js";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { randomUUID } from "crypto";
import { access } from "fs";
import { AuthError } from "@azure/msal-node";
import { listGroupIDsByEmail, getEntraIdToken } from "../functions/entraId.js";
import internal from "stream";

const LINKRY_MAX_SLUG_LENGTH = 1000;

type LinkrySlugOnlyRequest = {
  Params: { slug: string };
  Querystring: undefined;
  Body: undefined;
};

type OwnerRecord = {
  slug: string;
  redirect: string;
  access: string;
  updatedAtUtc: string;
  createdAtUtc: string;
  counter: number;
};

type AccessRecord = {
  slug: string;
  access: string;
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
  counter: z.number().optional(),
});

const deleteRequest = z.object({
  slug: z.string().min(1),
  redirect: z.optional(z.string().url().min(1)),
  groups: z.optional(z.array(z.string()).min(1)),
});

const patchRequest = z.object({
  slug: z.string().min(1).max(LINKRY_MAX_SLUG_LENGTH),
  access: z.array(z.string()).min(1),
  redirect: z.string().url().min(1),
  isEdited: z.boolean(),
  counter: z.number().optional(),
});

type LinkyCreateRequest = {
  Params: undefined;
  Querystring: undefined;
  Body: z.infer<typeof createRequest>;
};

type LinkryGetRequest = {
  Params: { slug: string };
  Querystring: undefined;
  Body: undefined;
};

type LinkyDeleteRequest = {
  Params: undefined;
  Querystring: undefined;
  Body: z.infer<typeof deleteRequest>;
};

type LinkryPatchRequest = {
  Params: { slug: string };
  Querystring: undefined;
  Body: z.infer<typeof patchRequest>;
};

const dynamoClient = new DynamoDBClient({
  region: genericConfig.AwsRegion,
});

const counterIncrement = async (targetSlug: string) => {
  const counterQueryParams = {
    TableName: genericConfig.LinkryDynamoTableName,
    KeyConditionExpression: "slug = :slug AND begins_with(access, :prefix)",
    ExpressionAttributeValues: {
      ":slug": { S: targetSlug },
      ":prefix": { S: "OWNER#" },
    },
  };
  let currentValue: number = 0;
  let access: string = "";
  try {
    const command = new QueryCommand(counterQueryParams);
    const queryResponse = await dynamoClient.send(command);
    if (
      !queryResponse ||
      !queryResponse.Items ||
      queryResponse.Items.length != 1
    ) {
      return;
    }
    currentValue = unmarshall(queryResponse.Items[0]).counter || 0; // or 0 so it adds a counter if it is not defined during post.
    access = unmarshall(queryResponse.Items[0]).access;
  } catch (e: unknown) {
    console.error("Error querying : counter increment");
    console.error(e);
  }
  const counterUpdateParams = {
    TableName: genericConfig.LinkryDynamoTableName,
    Key: {
      slug: { S: targetSlug },
      access: { S: access },
    },
    UpdateExpression: "SET #c = :newCounter",
    ExpressionAttributeNames: {
      "#c": "counter",
    },
    ExpressionAttributeValues: marshall({
      ":newCounter": currentValue + 1,
    }),
  };
  try {
    const command = new UpdateItemCommand(counterUpdateParams);
    await dynamoClient.send(command);
  } catch (e: unknown) {
    console.error("Update counter failed");
    console.log(e);
  }
};

const linkryRoutes: FastifyPluginAsync = async (fastify, _options) => {
  fastify.get<LinkrySlugOnlyRequest>("/redir/:slug", async (request, reply) => {
    const slug = request.params.slug;
    const command = new QueryCommand({
      TableName: genericConfig.LinkryDynamoTableName,
      KeyConditionExpression:
        "#slug = :slugVal AND begins_with(#access, :accessVal)",
      ExpressionAttributeNames: {
        "#slug": "slug",
        "#access": "access",
      },
      ExpressionAttributeValues: {
        ":slugVal": { S: slug },
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
      counterIncrement(slug);
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
            ![
              ...fastify.environmentConfig.LinkryGroupNameToGroupUUIDMap.keys(),
            ].includes(accessGroup)
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
        await fastify.authorize(request, reply, [
          AppRoles.LINKS_MANAGER,
          AppRoles.LINKS_ADMIN,
        ]);
      },
    },
    async (request, reply) => {
      //Use a transaction to handle if one/multiple of these writes fail
      const TransactItems: object[] = [];

      try {
        //Add the OWNER record
        const creationTime: Date = new Date();
        const ownerRecord: OwnerRecord = {
          slug: request.body.slug,
          redirect: request.body.redirect,
          access: "OWNER#" + request.username,
          updatedAtUtc: creationTime.toISOString(),
          createdAtUtc: creationTime.toISOString(),
          counter: request.body.counter || 0,
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
          const groupUUID: string =
            fastify.environmentConfig.LinkryGroupNameToGroupUUIDMap.get(
              accessGroup,
            ) as string;
          const groupRecord: AccessRecord = {
            slug: request.body.slug,
            access: "GROUP#" + groupUUID,
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
  fastify.get<LinkryGetRequest>(
    "/linkdata/:slug",
    {
      /*preValidation: async (request, reply) => {
        await fastify.zodValidateBody(request, reply, getRequest);
      },*/
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [
          AppRoles.LINKS_MANAGER,
          AppRoles.LINKS_ADMIN,
        ]);
      },
    },
    async (request, reply) => {
      try {
        const { slug: slug } = request.params;
        // Query to get all items with the specified slug
        const queryParams = {
          TableName: genericConfig.LinkryDynamoTableName,
          KeyConditionExpression: "slug = :slug",
          ExpressionAttributeValues: {
            ":slug": { S: decodeURIComponent(slug) },
          },
        };

        const queryCommand = new QueryCommand(queryParams);
        const queryResponse = await dynamoClient.send(queryCommand);

        const items: object[] = queryResponse.Items || [];
        const unmarshalledItems: (OwnerRecord | AccessRecord)[] = [];
        for (const item of items) {
          unmarshalledItems.push(
            unmarshall(item as { [key: string]: AttributeValue }) as
              | OwnerRecord
              | AccessRecord,
          );
        }
        if (items.length == 0)
          throw new DatabaseFetchError({ message: "Slug does not exist" });

        //TODO: cache response;

        const ownerRecord: OwnerRecord = unmarshalledItems.filter(
          (item): item is OwnerRecord => "redirect" in item,
        )[0];

        const accessGroupNames: string[] = [];
        for (const record of unmarshalledItems) {
          if (record && record != ownerRecord) {
            const accessGroupUUID: string = record.access.split("GROUP#")[1];
            accessGroupNames.push(
              fastify.environmentConfig.LinkryGroupUUIDToGroupNameMap.get(
                accessGroupUUID,
              ) as string,
            );
          }
        }

        const entraIdToken = await getEntraIdToken(
          fastify.environmentConfig.AadValidClientId,
        );

        if (!request.username) {
          throw new Error("Username is undefined");
        }

        const allUserGroupUUIDs = await listGroupIDsByEmail(
          entraIdToken,
          request.username,
        );

        const linkryGroupUUIDs: string[] = [
          ...fastify.environmentConfig.LinkryGroupUUIDToGroupNameMap.keys(),
        ] as string[];

        const userLinkryGroups = allUserGroupUUIDs.filter((groupId) =>
          linkryGroupUUIDs.includes(groupId),
        );

        //FIXME: User should also be able to edit if they have an access group - Done
        if (
          (ownerRecord &&
            ownerRecord.access.split("OWNER#")[1] == request.username) ||
          userLinkryGroups.length > 0
        ) {
          reply.send({
            slug: ownerRecord.slug,
            access: accessGroupNames,
            redirect: ownerRecord.redirect,
            counter: ownerRecord.counter,
          });
        } else {
          throw new AuthError("User does not own slug.");
        }
      } catch (e: unknown) {
        console.log(e);
        throw new DatabaseFetchError({
          message: "Failed to fetch slug information in Dynamo table.",
        });
      }
    },
  );

  fastify.patch<LinkryPatchRequest>(
    "/redir/:slug",
    {
      preValidation: async (request, reply) => {
        await fastify.zodValidateBody(request, reply, createRequest);
        console.log(request.body.counter);
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
            ![
              ...fastify.environmentConfig.LinkryGroupNameToGroupUUIDMap.keys(),
            ].includes(accessGroup)
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
              ":slug": { S: request.params.slug },
            },
          };

          const queryCommand = new QueryCommand(queryParams);
          const queryResponse = await dynamoClient.send(queryCommand);
          if (queryResponse.Items && queryResponse.Items.length <= 0) {
            //TODO: throw a different error type so that the user can see the error message?
            throw new DatabaseInsertError({
              message: `Slug ${request.params.slug} Does not Exist in Database`,
            });
            // }else{
            //   console.log(`Slug ${request.params.slug} Exist in Database`)
            //   console.log(request.params.slug)
          }
        } catch (e: unknown) {
          console.log(e);
          throw new DatabaseFetchError({
            message: "The Slug does not exist in Database.",
          });
        }
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
      //throw new NotImplementedError({});
      /* 

      1. It has already been verified that the Slug Exists in the Database
      2. Update the redirect URL
      3. Owner Does not Change
      4. Determing Groups can be Added or Removed
      5. Perform the update

      */
      if (request.body.isEdited) {
        //as the request was edited, make updates
        const { slug } = request.params;
        const newRedirect = request.body.redirect;
        const newAccessGroups: string[] = request.body.access.map(
          (accessGroup) => {
            return fastify.environmentConfig.LinkryGroupNameToGroupUUIDMap.get(
              accessGroup,
            ) as string; //Converts frontend groupname to backend UUID
          },
        );
        const newCounter = request.body.counter;

        //get all the owner records from the datbase

        try {
          // Step 1: Query all records with the given slug
          const queryParams = {
            TableName: genericConfig.LinkryDynamoTableName,
            KeyConditionExpression: "slug = :slug",
            ExpressionAttributeValues: {
              ":slug": { S: decodeURIComponent(slug) },
            },
          };

          const queryCommand = new QueryCommand(queryParams);
          const queryResponse = await dynamoClient.send(queryCommand);

          const items = queryResponse.Items || [];

          const unmarshalledItems: (OwnerRecord | AccessRecord)[] = [];
          for (const item of items) {
            unmarshalledItems.push(
              unmarshall(item as { [key: string]: AttributeValue }) as
                | OwnerRecord
                | AccessRecord,
            );
          }
          if (items.length == 0)
            throw new DatabaseFetchError({ message: "Slug does not exist" });

          //console.log(items)

          // Step 2: Identify the OWNER record and update its redirect URL
          const ownerRecord: OwnerRecord = unmarshalledItems.filter(
            (item): item is OwnerRecord => "redirect" in item,
          )[0];

          if (!ownerRecord) {
            throw new DatabaseFetchError({ message: "Owner record not found" });
          }

          const ownerUpdateCommand = {
            Update: {
              TableName: genericConfig.LinkryDynamoTableName,
              Key: marshall({
                slug: ownerRecord.slug,
                access: ownerRecord.access,
              }),
              UpdateExpression: "SET redirect = :newRedirect, #c = :newCounter",
              ExpressionAttributeNames: {
                "#c": "counter", //Counter patch for all clear...
              },
              ExpressionAttributeValues: marshall({
                ":newRedirect": newRedirect,
                ":newCounter": newCounter,
              }),
            },
          };

          // Step 3: Identify and delete all GROUP records

          const existingGroupRecords = unmarshalledItems.filter((item) =>
            item.access.startsWith("GROUP#"),
          );

          const existingGroups: string[] = existingGroupRecords.map((record) =>
            record.access.replace("GROUP#", ""),
          );

          // Step 4: Determine groups to add and delete
          const groupsToAdd = newAccessGroups.filter(
            (group) => !existingGroups.includes(group),
          );
          const groupsToDelete = existingGroups.filter(
            (group) => group !== undefined && !newAccessGroups.includes(group),
          );

          const deleteGroupCommands = groupsToDelete.map((group) => ({
            Delete: {
              TableName: genericConfig.LinkryDynamoTableName,
              Key: marshall({
                slug: slug,
                access: `GROUP#${group}`,
              }),
            },
          }));

          // Step 4: Add new GROUP records
          const addGroupCommands = groupsToAdd.map((group) => ({
            Put: {
              TableName: genericConfig.LinkryDynamoTableName,
              Item: marshall({
                slug: slug,
                access: `GROUP#${group}`,
              }),
            },
          }));

          // Step 5: Perform all operations in a transaction
          const transactItems = [
            ownerUpdateCommand, // Update the OWNER record
            ...deleteGroupCommands, // Delete unnecessary GROUP records
            ...addGroupCommands, // Add new GROUP records
          ];

          await dynamoClient.send(
            new TransactWriteItemsCommand({ TransactItems: transactItems }),
          );

          reply.code(200).send({ message: "Record Edited successfully" });
        } catch (error) {
          console.error("Error updating slug:", error);
          reply.code(500).send({ error: "Failed to update slug" });
        }
      }

      //   console.log("queryParams", queryParams)

      //   const queryCommand = new QueryCommand(queryParams);
      //   const queryResponse = await dynamoClient.send(queryCommand);

      //   const items = queryResponse.Items || [];
      //   if (items.length === 0) {
      //     throw new NotFoundError({ message: "Slug does not exist" });
      //   }

      //   // Step 2: Prepare the transaction to update the slug
      //   const TransactItems = items.map((item) => {
      //     const unmarshalledItem = unmarshall(item);
      //     const newSlug = `new-${unmarshalledItem.slug}`; // Example: Modify the slug as needed

      //     return {
      //       Update: {
      //         TableName: genericConfig.LinkryDynamoTableName,
      //         Key: marshall({
      //           slug: unmarshalledItem.slug,
      //           access: unmarshalledItem.access,
      //         }),
      //         UpdateExpression: "SET slug = :newSlug, redirect = :redirect",
      //         ExpressionAttributeValues: marshall({
      //           ":newSlug": newSlug,
      //           ":redirect": redirect,
      //         }),
      //       },
      //     };
      //   });

      //   // Step 3: Execute the transaction
      //   await dynamoClient.send(
      //     new TransactWriteItemsCommand({ TransactItems })
      //   );

      //   reply.code(200).send({ message: "Slug updated successfully" });
      // } catch (error) {
      //   console.error("Error updating slug:", error);
      //   reply.code(500).send({ error: "Failed to update slug" });
      // }
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

        const desiredAccessValues: string[] = [
          ...fastify.environmentConfig.LinkryGroupUUIDToGroupNameMap.keys(),
        ] as string[];

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
    {
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [
          AppRoles.LINKS_MANAGER,
          AppRoles.LINKS_ADMIN,
        ]);
      },
    },
    async (request, reply) => {
      // console.log("******#*#")
      // console.log(request.headers)
      // if an admin, show all links
      // if a links manager, show all my links + links I can manage

      try {
        // console.log("******")
        // console.log(request.username)

        // const isAdmin = request?.includes(AppRoles.LINKS_ADMIN);

        // if (isAdmin) {

        // const response = await dynamoClient.send(
        //   new ScanCommand({ TableName: genericConfig.LinkryDynamoTableName }),
        // );

        //console.log(request)

        const command = new QueryCommand({
          TableName: genericConfig.LinkryDynamoTableName,
          IndexName: "AccessIndex",
          KeyConditionExpression: "#access = :accessVal",
          ExpressionAttributeNames: {
            "#access": "access",
          },
          ExpressionAttributeValues: {
            ":accessVal": { S: `OWNER#${request.username}` }, // Match OWNER#<username>
          },
          ScanIndexForward: false, // Sort in descending order
        });

        const response = await dynamoClient.send(command);

        //TODO: this is where we use the new listGroupIDsByEmail entraId route

        // const params = {
        //   TableName: genericConfig.LinkryDynamoTableName, // Replace with your actual table name
        //   IndexName: "AccessIndex",   // Your GSI name
        //   KeyConditionExpression: "access = :accessValue",
        //   ExpressionAttributeValues: {
        //     ":accessValue": { S: `OWNER#${request.username}` }
        //   }
        // };

        // const response = await dynamoClient.send(new QueryCommand(params));
        //console.log(response.Items);

        const items =
          response.Items?.map((item) => {
            const unmarshalledItem = unmarshall(item);

            // Strip '#' from access field
            if (unmarshalledItem.access) {
              unmarshalledItem.access =
                unmarshalledItem.access.split("#")[1] ||
                unmarshalledItem.access;
            }
            return unmarshalledItem;
          }) || [];

        // console.log("items =")

        // console.log("items =" + items )

        const ownnedUniqueSlugs = Array.from(
          new Set(
            items
              .filter((item) => item.slug) // Filter out items without a slug
              .map((item) => item.slug), // Extract slugs
          ),
        );

        //console.log("Unique Slugs:", uniqueSlugs);

        const ownedLinks = await Promise.all(
          ownnedUniqueSlugs.map(async (slug) => {
            const groupQueryCommand = new QueryCommand({
              TableName: genericConfig.LinkryDynamoTableName,
              KeyConditionExpression:
                "#slug = :slugVal AND begins_with(#access, :accessVal)",
              ExpressionAttributeNames: {
                "#slug": "slug",
                "#access": "access",
              },
              ExpressionAttributeValues: {
                ":slugVal": { S: slug },
                ":accessVal": { S: "GROUP#" },
              },
              ScanIndexForward: false,
            });

            const groupQueryResponse =
              await dynamoClient.send(groupQueryCommand);
            const groupItems = groupQueryResponse.Items?.map((item) =>
              unmarshall(item),
            );

            const combinedAccessGroupUUIDs: string[] =
              groupItems?.map((item) => item.access.replace("GROUP#", "")) ||
              [];

            const combinedAccessGroupNames: string[] = [];

            for (const accessGroupUUID of combinedAccessGroupUUIDs) {
              combinedAccessGroupNames.push(
                fastify.environmentConfig.LinkryGroupUUIDToGroupNameMap.get(
                  accessGroupUUID,
                ) as string,
              );
            }

            // Combine GROUP# values into a single string separated by ";"
            const combinedAccessGroups = combinedAccessGroupNames.join(";");

            // Find the original record for this slug and add the combined access groups
            const originalRecord = (items ?? []).find(
              (item) => item.slug === slug,
            );
            return {
              ...originalRecord,
              access: combinedAccessGroups || "",
            };
          }),
        );

        const entraIdToken = await getEntraIdToken(
          fastify.environmentConfig.AadValidClientId,
        );

        if (!request.username) {
          throw new Error("Username is undefined");
        }
        const allUserGroupUUIDs = await listGroupIDsByEmail(
          entraIdToken,
          request.username,
        );

        //console.log("********allUserGroupIds =" + allUserGroupUUIDs)
        const linkryGroupUUIDs: string[] = [
          ...fastify.environmentConfig.LinkryGroupUUIDToGroupNameMap.keys(),
        ] as string[];

        const userLinkrallUserGroups = allUserGroupUUIDs.filter((groupId) => {
          //testing hijack
          /*console.log(groupId);
              if (groupId != '99b6b87c-9550-4529-87c1-f40862ab7add') { 
                return false;
              } */
          return linkryGroupUUIDs.includes(groupId);
        });

        //console.log(linkryGroupUUIDs);

        //console.log(allUserGroupUUIDs);

        //console.log("userLinkrallUserGroups =" + userLinkrallUserGroups)

        const delegatedLinks = await Promise.all(
          userLinkrallUserGroups.map(async (group) => {
            // Use ScanCommand to query all records where access starts with "GROUP#[value]"
            const groupScanCommand = new ScanCommand({
              TableName: genericConfig.LinkryDynamoTableName,
              FilterExpression: "begins_with(#access, :accessVal)",
              ExpressionAttributeNames: {
                "#access": "access",
              },
              ExpressionAttributeValues: {
                ":accessVal": { S: `GROUP#${group}` },
              },
            });

            const groupScanResponse = await dynamoClient.send(groupScanCommand);
            const groupItems = groupScanResponse.Items?.map((item) =>
              unmarshall(item),
            );

            //console.log("groupItems1 = " + JSON.stringify(groupItems));

            // Get unique slugs from groupItems and remove previously seen slugs
            const delegatedUniqueSlugs = Array.from(
              new Set(
                (groupItems ?? [])
                  .filter(
                    (item) =>
                      item.slug && !ownnedUniqueSlugs.includes(item.slug),
                  ) // Exclude slugs already seen
                  .map((item) => item.slug), // Extract slugs
              ),
            );

            //console.log("Filtered uniqueSlugs=" + delegatedUniqueSlugs);

            // For each unique slug, find the corresponding "OWNER#" record and access groups
            const ownerRecords = await Promise.all(
              delegatedUniqueSlugs.map(async (slug) => {
                // Query for OWNER# record
                const ownerQueryCommand = new QueryCommand({
                  TableName: genericConfig.LinkryDynamoTableName,
                  KeyConditionExpression:
                    "#slug = :slugVal AND begins_with(#access, :ownerVal)",
                  ExpressionAttributeNames: {
                    "#slug": "slug",
                    "#access": "access",
                  },
                  ExpressionAttributeValues: {
                    ":slugVal": { S: slug }, // Match the delegated unique slug
                    ":ownerVal": { S: "OWNER#" }, // Match access starting with "OWNER#"
                  },
                });

                const ownerQueryResponse =
                  await dynamoClient.send(ownerQueryCommand);
                const ownerItems = ownerQueryResponse.Items?.map((item) =>
                  unmarshall(item),
                );

                //console.log(ownerItems)

                // Query for GROUP# records
                const groupQueryCommand = new QueryCommand({
                  TableName: genericConfig.LinkryDynamoTableName,
                  KeyConditionExpression:
                    "#slug = :slugVal AND begins_with(#access, :groupVal)",
                  ExpressionAttributeNames: {
                    "#slug": "slug",
                    "#access": "access",
                  },
                  ExpressionAttributeValues: {
                    ":slugVal": { S: slug }, // Match the delegated unique slug
                    ":groupVal": { S: "GROUP#" }, // Match access starting with "GROUP#"
                  },
                });

                const groupQueryResponse =
                  await dynamoClient.send(groupQueryCommand);
                const groupItems = groupQueryResponse.Items?.map((item) =>
                  unmarshall(item),
                );

                const combinedAccessGroupUUIDs: string[] =
                  groupItems?.map((item) =>
                    item.access.replace("GROUP#", ""),
                  ) || [];

                const combinedAccessGroupNames: string[] = [];

                for (const accessGroupUUID of combinedAccessGroupUUIDs) {
                  combinedAccessGroupNames.push(
                    fastify.environmentConfig.LinkryGroupUUIDToGroupNameMap.get(
                      accessGroupUUID,
                    ) as string,
                  );
                }

                // Combine GROUP# values into a single string separated by ";"
                const combinedAccessGroups = combinedAccessGroupNames.join(";");

                // Combine OWNER# record with access groups
                return ownerItems?.map((ownerItem) => ({
                  ...ownerItem,
                  access: `${ownerItem.access.split("#")[1]};${combinedAccessGroups}`, // Append access groups to OWNER# access
                }));
              }),
            );

            return ownerRecords.flat(); // Flatten the results for this group
          }),
        );

        // Flatten the results into a single array
        const flattenedDelegatedLinks = delegatedLinks.flat();

        const results = {
          ownedLinks: ownedLinks,
          delegatedLinks: flattenedDelegatedLinks,
        };

        reply.send(results);
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
