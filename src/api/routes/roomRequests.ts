import {
  type FastifyInstance,
  FastifyPluginAsync,
  type FastifyRequest,
} from "fastify";
import rateLimiter from "api/plugins/rateLimiter.js";
import {
  formatStatus,
  roomRequestSchema,
  RoomRequestStatus,
  roomRequestStatusUpdateRequest,
} from "common/types/roomRequest.js";
import { AppRoles } from "common/roles.js";
import {
  BaseError,
  DatabaseFetchError,
  DatabaseInsertError,
  InternalServerError,
  NotFoundError,
} from "common/errors/index.js";
import {
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
  UpdateItemCommand,
  type QueryCommandOutput,
} from "@aws-sdk/client-dynamodb";
import { genericConfig, notificationRecipients } from "common/config.js";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { AvailableSQSFunctions, SQSPayload } from "common/types/sqsMessage.js";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { semesterId, withRoles, withTags } from "api/components/index.js";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import * as z from "zod/v4";
import { buildAuditLogTransactPut } from "api/functions/auditLog.js";
import { Modules } from "common/modules.js";
import {
  generateProjectionParams,
  getAllUserEmails,
  getDefaultFilteringQuerystring,
} from "common/utils.js";
import {
  ROOM_RESERVATION_RETENTION_DAYS,
  UPLOAD_GRACE_PERIOD_MS,
} from "common/constants.js";
import { createPresignedGet, createPresignedPut } from "api/functions/s3.js";
import { HeadObjectCommand, NotFound, S3Client } from "@aws-sdk/client-s3";
import { assertAuthenticated } from "api/authenticated.js";
import { Organizations } from "@acm-uiuc/js-shared";

async function verifyRoomRequestAccess(
  fastify: FastifyInstance,
  request: FastifyRequest,
  requestId: string,
  semesterId: string,
): Promise<QueryCommandOutput> {
  let command: QueryCommand;
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

  const resp = await fastify.dynamoClient.send(command);
  if (!resp.Items || resp.Count !== 1) {
    throw new DatabaseFetchError({
      message: "Recieved no database item.",
    });
  }

  return resp;
}

const roomRequestRoutes: FastifyPluginAsync = async (fastify, _options) => {
  await fastify.register(rateLimiter, {
    limit: 20,
    duration: 30,
    rateLimitIdentifier: "roomRequests",
  });
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/:semesterId/:requestId/status",
    {
      schema: withRoles(
        [AppRoles.ROOM_REQUEST_UPDATE],
        withTags(["Room Requests"], {
          summary: "Create status update for a room request.",
          params: z.object({
            requestId: z.string().min(1).meta({
              description: "Room request ID.",
              example: "6667e095-8b04-4877-b361-f636f459ba42",
            }),
            semesterId,
          }),
          body: roomRequestStatusUpdateRequest,
          response: {
            201: {
              description: "The room request status was updated.",
              content: {
                "application/json": {
                  schema: z.object({
                    uploadUrl: z.optional(z.url()),
                  }),
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      const requestId = request.params.requestId;
      const semesterId = request.params.semesterId;
      const attachmentS3key = request.body.attachmentInfo
        ? `roomRequests/${requestId}/${request.body.status}/${request.id}/${request.body.attachmentInfo.filename}`
        : undefined;
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
      let uploadUrl: string | undefined = undefined;
      if (request.body.attachmentInfo) {
        const { fileSizeBytes, contentType } = request.body.attachmentInfo;
        request.log.info(
          request.body.attachmentInfo,
          `Creating presigned URL to store attachment`,
        );
        if (!fastify.s3Client) {
          fastify.s3Client = new S3Client({
            region: genericConfig.AwsRegion,
          });
        }
        uploadUrl = await createPresignedPut({
          s3client: fastify.s3Client,
          key: attachmentS3key!,
          bucketName: fastify.environmentConfig.AssetsBucketId,
          length: fileSizeBytes,
          mimeType: contentType,
        });
      }
      const createdNotified =
        await fastify.dynamoClient.send(getReservationData);
      if (!createdNotified.Items || createdNotified.Count === 0) {
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
      const itemPut = {
        TableName: genericConfig.RoomRequestsStatusTableName,
        Item: marshall(
          {
            ...request.body,
            requestId,
            semesterId,
            "createdAt#status": `${createdAt}#${request.body.status}`,
            createdBy: request.username,
            expiresAt:
              Math.floor(Date.now() / 1000) +
              86400 * ROOM_RESERVATION_RETENTION_DAYS,
            attachmentS3key,
          },
          { removeUndefinedValues: true },
        ),
      };
      const logStatement = buildAuditLogTransactPut({
        entry: {
          module: Modules.ROOM_RESERVATIONS,
          actor: request.username,
          target: `${semesterId}/${requestId}`,
          requestId: request.id,
          message: `Changed status to "${formatStatus(request.body.status)}".`,
        },
      });
      try {
        await fastify.dynamoClient.send(
          new TransactWriteItemsCommand({
            TransactItems: [
              { Put: itemPut },
              ...(logStatement ? [logStatement] : []),
            ],
          }),
        );
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
          to: getAllUserEmails(originalRequestor),
          subject: "Room Reservation Request Status Change",
          content: `Your Room Reservation Request has been been moved to status "${formatStatus(request.body.status)}". Please visit the management portal for more details.`,
          callToActionButton: {
            name: "View Room Request",
            url: `${fastify.environmentConfig.UserFacingUrl}/roomRequests/${semesterId}/${requestId}`,
          },
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
          MessageGroupId: "roomReservationNotification",
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
      return reply.status(201).send({ uploadUrl });
    }),
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/:semesterId",
    {
      schema: withRoles(
        [AppRoles.ROOM_REQUEST_CREATE],
        withTags(["Room Requests"], {
          summary: "Get room requests for a specific semester.",
          params: z.object({
            semesterId,
          }),
          querystring: z.object(
            getDefaultFilteringQuerystring({
              defaultSelect: ["requestId", "title"],
            }),
          ),
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      const semesterId = request.params.semesterId;
      const { ProjectionExpression, ExpressionAttributeNames } =
        generateProjectionParams({ userFields: request.query.select });
      let command: QueryCommand;
      if (request.userRoles?.has(AppRoles.BYPASS_OBJECT_LEVEL_AUTH)) {
        command = new QueryCommand({
          TableName: genericConfig.RoomRequestsTableName,
          KeyConditionExpression: "semesterId = :semesterValue",
          ProjectionExpression,
          ExpressionAttributeNames,
          ExpressionAttributeValues: {
            ":semesterValue": { S: semesterId },
          },
        });
      } else {
        command = new QueryCommand({
          TableName: genericConfig.RoomRequestsTableName,
          KeyConditionExpression:
            "semesterId = :semesterValue AND begins_with(#sortKey, :username)",
          ExpressionAttributeNames: {
            "#sortKey": "userId#requestId",
            ...ExpressionAttributeNames,
          },
          ProjectionExpression,
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
        if (!request.query.select.includes("status")) {
          return unmarshall(x);
        }
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
            statusResponse.Items.length === 0
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
    }),
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "",
    {
      schema: withRoles(
        [AppRoles.ROOM_REQUEST_CREATE],
        withTags(["Room Requests"], {
          summary: "Create a room request.",
          body: roomRequestSchema,
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      const requestId = request.id;
      const body = {
        ...request.body,
        eventStart: request.body.eventStart.toISOString(),
        eventEnd: request.body.eventEnd.toISOString(),
        ...(request.body.recurrenceEndDate
          ? { recurrenceEndDate: request.body.recurrenceEndDate.toISOString() }
          : {}),
        requestId,
        userId: request.username,
        "userId#requestId": `${request.username}#${requestId}`,
        semesterId: request.body.semester,
        expiresAt:
          Math.floor(Date.now() / 1000) +
          86400 * ROOM_RESERVATION_RETENTION_DAYS,
      };
      const logStatement = buildAuditLogTransactPut({
        entry: {
          module: Modules.ROOM_RESERVATIONS,
          actor: request.username,
          target: `${request.body.semester}/${requestId}`,
          requestId: request.id,
          message: "Created room reservation request.",
        },
      });
      try {
        const createdAt = new Date().toISOString();
        const transactionCommand = new TransactWriteItemsCommand({
          TransactItems: [
            {
              Put: {
                TableName: genericConfig.RoomRequestsTableName,
                Item: marshall(body, { removeUndefinedValues: true }),
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
                  expiresAt:
                    Math.floor(Date.now() / 1000) +
                    86400 * ROOM_RESERVATION_RETENTION_DAYS,
                  notes: "This request was created by the user.",
                }),
              },
            },
            ...(logStatement ? [logStatement] : []),
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
          content: `A new room reservation request "${request.body.title}" has been created by ${Organizations[request.body.host].name}. Please visit the management portal for more details.`,
          callToActionButton: {
            name: "View Room Request",
            url: `${fastify.environmentConfig.UserFacingUrl}/roomRequests/${request.body.semester}/${requestId}`,
          },
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
          MessageGroupId: "roomReservationNotification",
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
    }),
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/:semesterId/:requestId",
    {
      schema: withRoles(
        [AppRoles.ROOM_REQUEST_CREATE],
        withTags(["Room Requests"], {
          summary: "Get specific room request data.",
          params: z.object({
            requestId: z.string().min(1).meta({
              description: "Room request ID.",
              example: "6667e095-8b04-4877-b361-f636f459ba42",
            }),
            semesterId: z.string().min(1).meta({
              description: "Short semester slug for a given semester.",
              example: "sp25",
            }),
          }),
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      const requestId = request.params.requestId;
      const semesterId = request.params.semesterId;
      try {
        const resp = await verifyRoomRequestAccess(
          fastify,
          request,
          requestId,
          semesterId,
        );
        // this isn't atomic, but that's fine - a little inconsistency on this isn't a problem.
        try {
          const statusesResponse = await fastify.dynamoClient.send(
            new QueryCommand({
              TableName: genericConfig.RoomRequestsStatusTableName,
              KeyConditionExpression: "requestId = :requestId",
              ExpressionAttributeValues: {
                ":requestId": { S: requestId },
              },
              ProjectionExpression:
                "#createdAt,#notes,#createdBy,#attachmentS3key",
              ExpressionAttributeNames: {
                "#createdBy": "createdBy",
                "#createdAt": "createdAt#status",
                "#notes": "notes",
                "#attachmentS3key": "attachmentS3key",
              },
            }),
          );
          const updates = statusesResponse.Items?.map((x) => {
            const unmarshalled = unmarshall(x);
            return {
              createdBy: unmarshalled.createdBy,
              createdAt: unmarshalled["createdAt#status"].split("#")[0],
              status: unmarshalled["createdAt#status"].split("#")[1],
              notes: unmarshalled.notes,
              attachmentFilename: unmarshalled.attachmentS3key
                ? (unmarshalled.attachmentS3key as string).split("/").at(-1)
                : undefined,
            };
          });
          if (!resp.Items || resp.Count !== 1) {
            throw new DatabaseFetchError({
              message: "Recieved no database item.",
            });
          }
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
    }),
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/:semesterId/:requestId/attachmentDownloadUrl/:createdAt/:status",
    {
      schema: withRoles(
        [AppRoles.ROOM_REQUEST_CREATE],
        withTags(["Room Requests"], {
          summary:
            "Get attachment download URL for a specific room request update.",
          params: z.object({
            requestId: z.string().min(1).meta({
              description: "Room request ID.",
              example: "6667e095-8b04-4877-b361-f636f459ba42",
            }),
            semesterId: z.string().min(1).meta({
              description: "Short semester slug for a given semester.",
              example: "sp25",
            }),
            createdAt: z.iso.datetime().meta({
              description: "When the update was created",
              example: "2025-10-26T22:05:22.980Z",
            }),
            status: z.enum(RoomRequestStatus).meta({
              description: "The status for this room request update",
              example: RoomRequestStatus.APPROVED,
            }),
          }),
          response: {
            200: {
              description:
                "The attachment was found and a download link was generated.",
              content: {
                "application/json": {
                  schema: z.object({
                    downloadUrl: z.url(),
                  }),
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      const requestId = request.params.requestId;
      const semesterId = request.params.semesterId;
      try {
        const resp = await verifyRoomRequestAccess(
          fastify,
          request,
          requestId,
          semesterId,
        );
        // this isn't atomic, but that's fine - a little inconsistency on this isn't a problem.
        try {
          const statusesResponse = await fastify.dynamoClient.send(
            new GetItemCommand({
              TableName: genericConfig.RoomRequestsStatusTableName,
              Key: {
                requestId: { S: request.params.requestId },
                "createdAt#status": {
                  S: `${request.params.createdAt}#${request.params.status}`,
                },
              },
              ProjectionExpression: "#attachmentS3key",
              ExpressionAttributeNames: {
                "#attachmentS3key": "attachmentS3key",
              },
            }),
          );
          if (!statusesResponse.Item) {
            throw new NotFoundError({
              endpointName: request.url,
            });
          }
          const unmarshalled = unmarshall(statusesResponse.Item) as {
            attachmentS3key?: string;
          };
          if (!unmarshalled.attachmentS3key) {
            throw new NotFoundError({
              endpointName: request.url,
            });
          }
          if (!fastify.s3Client) {
            fastify.s3Client = new S3Client({
              region: genericConfig.AwsRegion,
            });
          }
          try {
            await fastify.s3Client.send(
              new HeadObjectCommand({
                Bucket: fastify.environmentConfig.AssetsBucketId,
                Key: unmarshalled.attachmentS3key,
              }),
            );
          } catch (error) {
            if (error instanceof NotFound) {
              // Check if grace period has passed since creation
              const createdAt = new Date(request.params.createdAt);
              const now = new Date();
              const timeSinceCreation = now.getTime() - createdAt.getTime();

              if (timeSinceCreation >= UPLOAD_GRACE_PERIOD_MS) {
                // Grace period has passed, delete the attribute from DynamoDB
                await fastify.dynamoClient.send(
                  new UpdateItemCommand({
                    TableName: genericConfig.RoomRequestsStatusTableName,
                    Key: {
                      requestId: { S: request.params.requestId },
                      "createdAt#status": {
                        S: `${request.params.createdAt}#${request.params.status}`,
                      },
                    },
                    UpdateExpression: "REMOVE #attachmentS3key",
                    ExpressionAttributeNames: {
                      "#attachmentS3key": "attachmentS3key",
                    },
                  }),
                );
              }

              throw new NotFoundError({
                endpointName: request.url,
              });
            } else {
              throw error;
            }
          }
          const url = await createPresignedGet({
            s3client: fastify.s3Client,
            bucketName: fastify.environmentConfig.AssetsBucketId,
            key: unmarshalled.attachmentS3key,
          });
          return reply.status(200).send({ downloadUrl: url });
        } catch (e) {
          if (e instanceof NotFoundError) {
            throw e;
          }
          request.log.error(e);
          throw new DatabaseFetchError({
            message: "Could not get request attachments.",
          });
        }
      } catch (e) {
        request.log.error(e);
        if (e instanceof BaseError) {
          throw e;
        }
        throw new DatabaseFetchError({
          message: "Could not find by ID.",
        });
      }
    }),
  );
};

export default roomRequestRoutes;
