import {
  type FastifyInstance,
  FastifyPluginAsync,
  type FastifyRequest,
} from "fastify";
import rateLimiter from "api/plugins/rateLimiter.js";
import {
  editableRoomRequestStatuses,
  formatStatus,
  isEditableRoomRequestStatus,
  roomRequestEditSchema,
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
  ResourceConflictError,
  UnauthorizedError,
  ValidationError,
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
  ROOM_RESERVATION_RETENTION_DAYS_QA,
  UPLOAD_GRACE_PERIOD_MS,
} from "common/constants.js";
import { createPresignedGet, createPresignedPut } from "api/functions/s3.js";
import { HeadObjectCommand, NotFound, S3Client } from "@aws-sdk/client-s3";
import { assertAuthenticated } from "api/authenticated.js";
import { Organizations } from "@acm-uiuc/js-shared";
import { getUserOrgRoles } from "api/functions/organizations.js";

async function assertCanManageRoomRequest({
  fastify,
  request,
  host,
}: {
  fastify: FastifyInstance;
  request: FastifyRequest;
  host: string;
}): Promise<void> {
  if (request.userRoles?.has(AppRoles.ROOM_REQUEST_ADMIN)) {
    return;
  }
  if (!request.username) {
    throw new UnauthorizedError({ message: "User is not authenticated." });
  }
  const userOrgRoles = await getUserOrgRoles({
    username: request.username,
    dynamoClient: fastify.dynamoClient,
    logger: request.log,
  });
  const leadRoles = userOrgRoles
    .filter((x) => x.role === "LEAD")
    .map((x) => x.org);
  if (!leadRoles.includes(host as (typeof leadRoles)[number])) {
    throw new UnauthorizedError({
      message:
        "User is not authorized to manage room requests for this organization.",
    });
  }
}

async function verifyRoomRequestAccess(
  fastify: FastifyInstance,
  request: FastifyRequest,
  requestId: string,
  semesterId: string,
): Promise<QueryCommandOutput> {
  let command: QueryCommand;
  if (
    request.userRoles?.has(AppRoles.ROOM_REQUEST_ADMIN) ||
    request.userRoles?.has(AppRoles.ROOM_REQUEST_VIEW_ALL)
  ) {
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
      message: "Received no database item.",
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
          logger: request.log,
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
              86400 *
                (fastify.runEnvironment === "prod"
                  ? ROOM_RESERVATION_RETENTION_DAYS
                  : ROOM_RESERVATION_RETENTION_DAYS_QA),
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
      const updateMainCurrentStatus = {
        Update: {
          TableName: genericConfig.RoomRequestsTableName,
          Key: marshall({
            semesterId,
            "userId#requestId": `${originalRequestor}#${requestId}`,
          }),
          UpdateExpression: "SET #currentStatus = :status",
          ExpressionAttributeNames: { "#currentStatus": "currentStatus" },
          ExpressionAttributeValues: marshall({
            ":status": request.body.status,
          }),
        },
      };
      try {
        await fastify.dynamoClient.send(
          new TransactWriteItemsCommand({
            TransactItems: [
              { Put: itemPut },
              updateMainCurrentStatus,
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
        [AppRoles.ROOM_REQUEST_CREATE, AppRoles.ROOM_REQUEST_VIEW_ALL],
        withTags(["Room Requests"], {
          summary: "Get room requests for a specific semester.",
          params: z.object({
            semesterId,
          }),
          querystring: z.object(
            getDefaultFilteringQuerystring({
              defaultSelect: ["requestId", "title", "requestsSccsRoom"],
            }),
          ),
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      const semesterId = request.params.semesterId;
      const selectedFields = request.query.select.map((f) =>
        f === "status" ? "currentStatus" : f,
      );
      const { ProjectionExpression, ExpressionAttributeNames } =
        generateProjectionParams({ userFields: selectedFields });
      let command: QueryCommand;
      if (
        request.userRoles?.has(AppRoles.ROOM_REQUEST_ADMIN) ||
        request.userRoles?.has(AppRoles.ROOM_REQUEST_VIEW_ALL)
      ) {
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
      const wantsStatus = request.query.select.includes("status");
      const items = await Promise.all(
        response.Items.map(async (x) => {
          const item = unmarshall(x);
          if (!wantsStatus) {
            return item;
          }
          if (item.currentStatus) {
            item.status = item.currentStatus;
            delete item.currentStatus;
            return item;
          }
          // Backfill fallback: for legacy rows without currentStatus,
          // query the status history table for the latest status.
          const statusResponse = await fastify.dynamoClient.send(
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
          const latest =
            statusResponse.Items && statusResponse.Items.length > 0
              ? unmarshall(statusResponse.Items[0]).status
              : "unknown";
          item.status = latest;
          return item;
        }),
      );

      return reply.status(200).send(items);
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
      await assertCanManageRoomRequest({
        fastify,
        request,
        host: request.body.host,
      });
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
        currentStatus: RoomRequestStatus.CREATED,
        expiresAt:
          Math.floor(Date.now() / 1000) +
          86400 *
            (fastify.runEnvironment === "prod"
              ? ROOM_RESERVATION_RETENTION_DAYS
              : ROOM_RESERVATION_RETENTION_DAYS_QA),
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
                    86400 *
                      (fastify.runEnvironment === "prod"
                        ? ROOM_RESERVATION_RETENTION_DAYS
                        : ROOM_RESERVATION_RETENTION_DAYS_QA),
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
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().patch(
    "/:semesterId/:requestId",
    {
      schema: withRoles(
        [AppRoles.ROOM_REQUEST_CREATE],
        withTags(["Room Requests"], {
          summary:
            "Edit a room request. Only allowed while the request is in the created status.",
          params: z.object({
            requestId: z.string().min(1).meta({
              description: "Room request ID.",
              example: "6667e095-8b04-4877-b361-f636f459ba42",
            }),
            semesterId,
          }),
          body: roomRequestEditSchema,
          response: {
            200: {
              description: "The room request was updated.",
              content: {
                "application/json": {
                  schema: z.object({
                    id: z.string(),
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
      const body = request.body as z.infer<typeof roomRequestEditSchema>;
      const { reason, ...updates } = body;
      const updateEntries = Object.entries(updates).filter(
        ([, v]) => v !== undefined,
      );
      if (updateEntries.length === 0) {
        throw new ValidationError({
          message: "At least one field must be provided to update.",
        });
      }
      const isSuperuser = request.userRoles?.has(AppRoles.ROOM_REQUEST_ADMIN);
      let existing: {
        userId: string;
        "userId#requestId": string;
        host: string;
        expiresAt: number;
        currentStatus?: RoomRequestStatus;
      };
      if (isSuperuser) {
        const existingResp = await fastify.dynamoClient.send(
          new QueryCommand({
            TableName: genericConfig.RoomRequestsTableName,
            IndexName: "RequestIdIndex",
            KeyConditionExpression: "requestId = :requestId",
            FilterExpression: "semesterId = :semesterId",
            ExpressionAttributeValues: {
              ":requestId": { S: requestId },
              ":semesterId": { S: semesterId },
            },
            Limit: 1,
          }),
        );
        if (!existingResp.Items || existingResp.Count !== 1) {
          throw new NotFoundError({ endpointName: request.url });
        }
        existing = unmarshall(existingResp.Items[0]) as typeof existing;
      } else {
        const existingResp = await fastify.dynamoClient.send(
          new GetItemCommand({
            TableName: genericConfig.RoomRequestsTableName,
            Key: marshall({
              semesterId,
              "userId#requestId": `${request.username}#${requestId}`,
            }),
          }),
        );
        if (!existingResp.Item) {
          throw new NotFoundError({ endpointName: request.url });
        }
        existing = unmarshall(existingResp.Item) as typeof existing;
        const effectiveHost = (updates.host ?? existing.host) as string;
        await assertCanManageRoomRequest({
          fastify,
          request,
          host: effectiveHost,
        });
      }
      let effectiveStatus: RoomRequestStatus | undefined =
        existing.currentStatus;
      if (!effectiveStatus) {
        // Legacy fallback for rows without denormalized currentStatus:
        // walk the status history newest-first and ignore EDITED entries.
        const statusResp = await fastify.dynamoClient.send(
          new QueryCommand({
            TableName: genericConfig.RoomRequestsStatusTableName,
            KeyConditionExpression: "requestId = :requestId",
            FilterExpression: "#status <> :edited",
            ExpressionAttributeValues: {
              ":requestId": { S: requestId },
              ":edited": { S: RoomRequestStatus.EDITED },
            },
            ProjectionExpression: "#status",
            ExpressionAttributeNames: {
              "#status": "status",
            },
            ScanIndexForward: false,
          }),
        );
        if (!statusResp.Items || statusResp.Items.length === 0) {
          request.log.error(
            { roomRequest: requestId },
            "No status response items found.",
          );
          throw new DatabaseFetchError({
            message: "Could not determine current status of room request.",
          });
        }
        effectiveStatus = unmarshall(statusResp.Items[0]).status;
      }
      if (!isEditableRoomRequestStatus(effectiveStatus)) {
        throw new ResourceConflictError({
          message: `Room request cannot be edited while in the "${formatStatus(effectiveStatus as RoomRequestStatus)}" state.`,
        });
      }
      const normalizedUpdates: Record<string, unknown> = {};
      for (const [key, value] of updateEntries) {
        if (value instanceof Date) {
          normalizedUpdates[key] = value.toISOString();
        } else {
          normalizedUpdates[key] = value;
        }
      }
      const updateExprAttrNames: Record<string, string> = {
        "#userIdRequestId": "userId#requestId",
        "#currentStatus": "currentStatus",
      };
      const updateExprAttrValues: Record<string, unknown> = {};
      editableRoomRequestStatuses.forEach((status, i) => {
        updateExprAttrValues[`:editable${i}`] = status;
      });
      const editableConditionList = editableRoomRequestStatuses
        .map((_, i) => `:editable${i}`)
        .join(", ");
      const setParts: string[] = [];
      let idx = 0;
      for (const [key, value] of Object.entries(normalizedUpdates)) {
        const nameKey = `#u${idx}`;
        const valKey = `:u${idx}`;
        updateExprAttrNames[nameKey] = key;
        updateExprAttrValues[valKey] = value;
        setParts.push(`${nameKey} = ${valKey}`);
        idx++;
      }
      const changedFields = Object.keys(normalizedUpdates);
      const existingRecord = existing as unknown as Record<string, unknown>;
      const diff: Record<string, { old: unknown; new: unknown }> = {};
      for (const [key, value] of Object.entries(normalizedUpdates)) {
        const oldValue = existingRecord[key];
        if (
          JSON.stringify(oldValue ?? null) !== JSON.stringify(value ?? null)
        ) {
          diff[key] = { old: oldValue ?? null, new: value };
        }
      }
      const logStatement = buildAuditLogTransactPut({
        entry: {
          module: Modules.ROOM_RESERVATIONS,
          actor: request.username,
          target: `${semesterId}/${requestId}`,
          requestId: request.id,
          message: `Edited room reservation request. Changed fields: ${changedFields.join(", ")}.`,
        },
      });
      const createdAt = new Date().toISOString();
      const editedStatusPut = {
        Put: {
          TableName: genericConfig.RoomRequestsStatusTableName,
          Item: marshall(
            {
              requestId,
              semesterId,
              "createdAt#status": `${createdAt}#${RoomRequestStatus.EDITED}`,
              createdBy: request.username,
              status: RoomRequestStatus.EDITED,
              expiresAt:
                Math.floor(Date.now() / 1000) +
                86400 *
                  (fastify.runEnvironment === "prod"
                    ? ROOM_RESERVATION_RETENTION_DAYS
                    : ROOM_RESERVATION_RETENTION_DAYS_QA),
              notes: reason,
              diff:
                Object.keys(diff).length > 0 ? JSON.stringify(diff) : undefined,
            },
            { removeUndefinedValues: true },
          ),
        },
      };
      try {
        await fastify.dynamoClient.send(
          new TransactWriteItemsCommand({
            TransactItems: [
              {
                Update: {
                  TableName: genericConfig.RoomRequestsTableName,
                  Key: marshall({
                    semesterId,
                    "userId#requestId": existing["userId#requestId"],
                  }),
                  UpdateExpression: `SET ${setParts.join(", ")}`,
                  ConditionExpression: `attribute_exists(semesterId) AND attribute_exists(#userIdRequestId) AND (attribute_not_exists(#currentStatus) OR #currentStatus IN (${editableConditionList}))`,
                  ExpressionAttributeNames: updateExprAttrNames,
                  ExpressionAttributeValues: marshall(updateExprAttrValues, {
                    removeUndefinedValues: true,
                  }),
                },
              },
              editedStatusPut,
              ...(logStatement ? [logStatement] : []),
            ],
          }),
        );
      } catch (e) {
        if (e instanceof BaseError) {
          throw e;
        }
        request.log.error(e);
        throw new DatabaseInsertError({
          message: "Could not update room request.",
        });
      }
      return reply.status(200).send({ id: requestId });
    }),
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/:semesterId/:requestId",
    {
      schema: withRoles(
        [AppRoles.ROOM_REQUEST_CREATE, AppRoles.ROOM_REQUEST_VIEW_ALL],
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
                "#createdAt,#notes,#createdBy,#attachmentS3key,#diff",
              ExpressionAttributeNames: {
                "#createdBy": "createdBy",
                "#createdAt": "createdAt#status",
                "#notes": "notes",
                "#attachmentS3key": "attachmentS3key",
                "#diff": "diff",
              },
            }),
          );
          const updates = statusesResponse.Items?.map((x) => {
            const unmarshalled = unmarshall(x);
            let parsedDiff: unknown = undefined;
            if (typeof unmarshalled.diff === "string") {
              try {
                parsedDiff = JSON.parse(unmarshalled.diff);
              } catch {
                parsedDiff = undefined;
              }
            }
            return {
              createdBy: unmarshalled.createdBy,
              createdAt: unmarshalled["createdAt#status"].split("#")[0],
              status: unmarshalled["createdAt#status"].split("#")[1],
              notes: unmarshalled.notes,
              attachmentFilename: unmarshalled.attachmentS3key
                ? (unmarshalled.attachmentS3key as string).split("/").at(-1)
                : undefined,
              diff: parsedDiff,
            };
          });
          if (!resp.Items || resp.Count !== 1) {
            throw new DatabaseFetchError({
              message: "Received no database item.",
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
        [AppRoles.ROOM_REQUEST_CREATE, AppRoles.ROOM_REQUEST_VIEW_ALL],
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
      await verifyRoomRequestAccess(fastify, request, requestId, semesterId);
      try {
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
            logger: request.log,
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
