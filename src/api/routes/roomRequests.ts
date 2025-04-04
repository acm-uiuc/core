import { FastifyPluginAsync } from "fastify";
import rateLimiter from "api/plugins/rateLimiter.js";
import {
  formatStatus,
  roomGetResponse,
  roomRequestBaseSchema,
  RoomRequestFormValues,
  roomRequestPostResponse,
  roomRequestSchema,
  RoomRequestStatus,
  RoomRequestStatusUpdatePostBody,
  roomRequestStatusUpdateRequest,
} from "common/types/roomRequest.js";
import { AppRoles } from "common/roles.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  BaseError,
  DatabaseFetchError,
  DatabaseInsertError,
  InternalServerError,
  UnauthenticatedError,
} from "common/errors/index.js";
import {
  PutItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { genericConfig, notificationRecipients } from "common/config.js";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import { AvailableSQSFunctions, SQSPayload } from "common/types/sqsMessage.js";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

const roomRequestRoutes: FastifyPluginAsync = async (fastify, _options) => {
  await fastify.register(rateLimiter, {
    limit: 20,
    duration: 30,
    rateLimitIdentifier: "roomRequests",
  });
  fastify.post<{
    Body: RoomRequestStatusUpdatePostBody;
    Params: { requestId: string; semesterId: string };
  }>(
    "/:semesterId/:requestId/status",
    {
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [AppRoles.ROOM_REQUEST_UPDATE]);
      },
      preValidation: async (request, reply) => {
        await fastify.zodValidateBody(
          request,
          reply,
          roomRequestStatusUpdateRequest,
        );
      },
    },
    async (request, reply) => {
      if (!request.username) {
        throw new InternalServerError({
          message: "Could not get username from request.",
        });
      }
      const requestId = request.params.requestId;
      const semesterId = request.params.semesterId;
      const getReservationData = new QueryCommand({
        TableName: genericConfig.RoomRequestsStatusTableName,
        KeyConditionExpression: "requestId = :requestId",
        FilterExpression: "#statusKey = :status",
        ExpressionAttributeNames: {
          "#statusKey": "status",
        },
        ExpressionAttributeValues: {
          ":status": { S: RoomRequestStatus.CREATED },
          ":requestId": { S: requestId },
        },
      });
      const createdNotified =
        await fastify.dynamoClient.send(getReservationData);
      if (!createdNotified.Items || createdNotified.Count == 0) {
        throw new InternalServerError({
          message: "Could not find original reservation request details",
        });
      }
      const originalRequestor = unmarshall(createdNotified.Items[0]).createdBy;
      if (!originalRequestor) {
        throw new InternalServerError({
          message: "Could not find original reservation requestor",
        });
      }
      const createdAt = new Date().toISOString();
      const command = new PutItemCommand({
        TableName: genericConfig.RoomRequestsStatusTableName,
        Item: marshall({
          requestId,
          semesterId,
          "createdAt#status": `${createdAt}#${request.body.status}`,
          createdBy: request.username,
          ...request.body,
        }),
      });
      try {
        await fastify.dynamoClient.send(command);
      } catch (e) {
        request.log.error(e);
        if (e instanceof BaseError) {
          throw e;
        }
        throw new DatabaseInsertError({
          message: "Could not save status update.",
        });
      }
      const sqsPayload: SQSPayload<AvailableSQSFunctions.EmailNotifications> = {
        function: AvailableSQSFunctions.EmailNotifications,
        metadata: {
          initiator: request.username,
          reqId: request.id,
        },
        payload: {
          to: [originalRequestor],
          subject: "Room Reservation Request Status Change",
          content: `Your Room Reservation Request has been been moved to status "${formatStatus(request.body.status)}". Please visit ${fastify.environmentConfig["UserFacingUrl"]}/roomRequests/${semesterId}/${requestId} to view details.`,
        },
      };
      if (!fastify.sqsClient) {
        fastify.sqsClient = new SQSClient({
          region: genericConfig.AwsRegion,
        });
      }
      const result = await fastify.sqsClient.send(
        new SendMessageCommand({
          QueueUrl: fastify.environmentConfig.SqsQueueUrl,
          MessageBody: JSON.stringify(sqsPayload),
        }),
      );
      if (!result.MessageId) {
        request.log.error(result);
        throw new InternalServerError({
          message: "Could not add room reservation email to queue.",
        });
      }
      request.log.info(
        `Queued room reservation email to SQS with message ID ${result.MessageId}`,
      );
      return reply.status(201).send();
    },
  );
  fastify.get<{
    Body: undefined;
    Params: { semesterId: string };
  }>(
    "/:semesterId",
    {
      schema: {
        response: {
          200: zodToJsonSchema(roomGetResponse),
        },
      },
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [AppRoles.ROOM_REQUEST_CREATE]);
      },
    },
    async (request, reply) => {
      const semesterId = request.params.semesterId;
      if (!request.username) {
        throw new InternalServerError({
          message: "Could not retrieve username.",
        });
      }
      let command: QueryCommand;
      if (request.userRoles?.has(AppRoles.BYPASS_OBJECT_LEVEL_AUTH)) {
        command = new QueryCommand({
          TableName: genericConfig.RoomRequestsTableName,
          KeyConditionExpression: "semesterId = :semesterValue",
          ExpressionAttributeValues: {
            ":semesterValue": { S: semesterId },
          },
        });
      } else {
        command = new QueryCommand({
          TableName: genericConfig.RoomRequestsTableName,
          KeyConditionExpression: "semesterId = :semesterValue",
          FilterExpression: "begins_with(#hashKey, :username)",
          ExpressionAttributeNames: {
            "#hashKey": "userId#requestId",
          },
          ProjectionExpression: "requestId, host, title, semester",
          ExpressionAttributeValues: {
            ":semesterValue": { S: semesterId },
            ":username": { S: request.username },
          },
        });
      }
      const response = await fastify.dynamoClient.send(command);
      if (!response.Items) {
        throw new DatabaseFetchError({
          message: "Could not get room requests.",
        });
      }
      const items = response.Items.map((x) => {
        const item = unmarshall(x) as {
          host: string;
          title: string;
          requestId: string;
          status: string;
        };
        const statusPromise = fastify.dynamoClient.send(
          new QueryCommand({
            TableName: genericConfig.RoomRequestsStatusTableName,
            KeyConditionExpression: "requestId = :requestId",
            ExpressionAttributeValues: {
              ":requestId": { S: item.requestId },
            },
            ProjectionExpression: "#status",
            ExpressionAttributeNames: {
              "#status": "status",
            },
            ScanIndexForward: false,
            Limit: 1,
          }),
        );

        return statusPromise.then((statusResponse) => {
          if (
            !statusResponse ||
            !statusResponse.Items ||
            statusResponse.Items.length == 0
          ) {
            return "unknown";
          }
          const statuses = statusResponse.Items.map((s) => unmarshall(s));
          const latestStatus = statuses.length > 0 ? statuses[0].status : null;
          return {
            ...item,
            status: latestStatus,
          };
        });
      });

      const itemsWithStatus = await Promise.all(items);

      return reply.status(200).send(itemsWithStatus);
    },
  );
  fastify.post<{ Body: RoomRequestFormValues }>(
    "/",
    {
      schema: {
        response: { 201: zodToJsonSchema(roomRequestPostResponse) },
      },
      preValidation: async (request, reply) => {
        await fastify.zodValidateBody(request, reply, roomRequestSchema);
      },
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [AppRoles.ROOM_REQUEST_CREATE]);
      },
    },
    async (request, reply) => {
      const requestId = request.id;
      if (!request.username) {
        throw new InternalServerError({
          message: "Could not retrieve username.",
        });
      }
      const body = {
        ...request.body,
        requestId,
        userId: request.username,
        "userId#requestId": `${request.username}#${requestId}`,
        semesterId: request.body.semester,
      };
      try {
        const createdAt = new Date().toISOString();
        const transactionCommand = new TransactWriteItemsCommand({
          TransactItems: [
            {
              Put: {
                TableName: genericConfig.RoomRequestsTableName,
                Item: marshall(body),
              },
            },
            {
              Put: {
                TableName: genericConfig.RoomRequestsStatusTableName,
                Item: marshall({
                  requestId,
                  semesterId: request.body.semester,
                  "createdAt#status": `${createdAt}#${RoomRequestStatus.CREATED}`,
                  createdBy: request.username,
                  status: RoomRequestStatus.CREATED,
                  notes: "This request was created by the user.",
                }),
              },
            },
          ],
        });
        await fastify.dynamoClient.send(transactionCommand);
      } catch (e) {
        if (e instanceof BaseError) {
          throw e;
        }
        request.log.error(e);
        throw new DatabaseInsertError({
          message: "Could not save room request.",
        });
      }
      reply.status(201).send({
        id: requestId,
        status: RoomRequestStatus.CREATED,
      });
      const sqsPayload: SQSPayload<AvailableSQSFunctions.EmailNotifications> = {
        function: AvailableSQSFunctions.EmailNotifications,
        metadata: {
          initiator: request.username,
          reqId: request.id,
        },
        payload: {
          to: [notificationRecipients[fastify.runEnvironment].OfficerBoard],
          subject: "New Room Reservation Request",
          content: `A new room reservation request has been created (${request.body.host} | ${request.body.title}). Please visit ${fastify.environmentConfig["UserFacingUrl"]}/roomRequests/${request.body.semester}/${requestId} to view details.`,
        },
      };
      if (!fastify.sqsClient) {
        fastify.sqsClient = new SQSClient({
          region: genericConfig.AwsRegion,
        });
      }
      const result = await fastify.sqsClient.send(
        new SendMessageCommand({
          QueueUrl: fastify.environmentConfig.SqsQueueUrl,
          MessageBody: JSON.stringify(sqsPayload),
        }),
      );
      if (!result.MessageId) {
        request.log.error(result);
        throw new InternalServerError({
          message: "Could not add room reservation email to queue.",
        });
      }
      request.log.info(
        `Queued room reservation email to SQS with message ID ${result.MessageId}`,
      );
    },
  );
  fastify.get<{
    Body: undefined;
    Params: { requestId: string; semesterId: string };
  }>(
    "/:semesterId/:requestId",
    {
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [AppRoles.ROOM_REQUEST_CREATE]);
      },
    },
    async (request, reply) => {
      const requestId = request.params.requestId;
      const semesterId = request.params.semesterId;
      let command;
      if (request.userRoles?.has(AppRoles.BYPASS_OBJECT_LEVEL_AUTH)) {
        command = new QueryCommand({
          TableName: genericConfig.RoomRequestsTableName,
          IndexName: "RequestIdIndex",
          KeyConditionExpression: "requestId = :requestId",
          FilterExpression: "semesterId = :semesterId",
          ExpressionAttributeValues: {
            ":requestId": { S: requestId },
            ":semesterId": { S: semesterId },
          },
          Limit: 1,
        });
      } else {
        command = new QueryCommand({
          TableName: genericConfig.RoomRequestsTableName,
          KeyConditionExpression:
            "semesterId = :semesterId AND #userIdRequestId = :userRequestId",
          ExpressionAttributeValues: {
            ":userRequestId": { S: `${request.username}#${requestId}` },
            ":semesterId": { S: semesterId },
          },
          ExpressionAttributeNames: {
            "#userIdRequestId": "userId#requestId",
          },
          Limit: 1,
        });
      }
      try {
        const resp = await fastify.dynamoClient.send(command);
        if (!resp.Items || resp.Count != 1) {
          throw new DatabaseFetchError({
            message: "Recieved no response.",
          });
        }
        // this isn't atomic, but that's fine - a little inconsistency on this isn't a problem.
        try {
          const statusesResponse = await fastify.dynamoClient.send(
            new QueryCommand({
              TableName: genericConfig.RoomRequestsStatusTableName,
              KeyConditionExpression: "requestId = :requestId",
              ExpressionAttributeValues: {
                ":requestId": { S: requestId },
              },
              ProjectionExpression: "#createdAt,#notes,#createdBy",
              ExpressionAttributeNames: {
                "#createdBy": "createdBy",
                "#createdAt": "createdAt#status",
                "#notes": "notes",
              },
            }),
          );
          const updates = statusesResponse.Items?.map((x) => {
            const unmarshalled = unmarshall(x);
            return {
              createdBy: unmarshalled["createdBy"],
              createdAt: unmarshalled["createdAt#status"].split("#")[0],
              status: unmarshalled["createdAt#status"].split("#")[1],
              notes: unmarshalled["notes"],
            };
          });
          return reply
            .status(200)
            .send({ data: unmarshall(resp.Items[0]), updates });
        } catch (e) {
          request.log.error(e);
          throw new DatabaseFetchError({
            message: "Could not get request status.",
          });
        }
      } catch (e) {
        request.log.error(e);
        if (e instanceof BaseError) {
          throw e;
        }
        throw new DatabaseInsertError({
          message: "Could not find by ID.",
        });
      }
    },
  );
};

export default roomRequestRoutes;
