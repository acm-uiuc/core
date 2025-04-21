import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { createAuditLogEntry } from "api/functions/auditLog.js";
import rateLimiter from "api/plugins/rateLimiter.js";
import { genericConfig } from "common/config.js";
import {
  BaseError,
  DatabaseFetchError,
  ValidationError,
} from "common/errors/index.js";
import { Modules } from "common/modules.js";
import { AppRoles } from "common/roles.js";
import fastify, { FastifyPluginAsync } from "fastify";
import { request } from "http";

type GetLogsRequest = {
  Params: { module: string };
  Querystring: { start: number; end: number };
  Body: undefined;
};

const logsPlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.register(rateLimiter, {
    limit: 10,
    duration: 30,
    rateLimitIdentifier: "logs",
  });
  fastify.get<GetLogsRequest>(
    "/:module",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["start", "end"],
          properties: {
            start: { type: "number" },
            end: { type: "number" },
          },
          additionalProperties: false,
        },
      },
      onRequest: async (request, reply) => {
        await fastify.authorize(request, reply, [AppRoles.AUDIT_LOG_VIEWER]);
      },
      preValidation: async (request, reply) => {
        const { module } = request.params;
        const { start, end } = request.query;

        if (!Object.values(Modules).includes(module as Modules)) {
          throw new ValidationError({ message: `Invalid module "${module}".` });
        }
        if (end <= start) {
          throw new ValidationError({
            message: `End must be greater than start.`,
          });
        }
      },
    },
    async (request, reply) => {
      const { module } = request.params;
      const { start, end } = request.query;
      const logPromise = createAuditLogEntry({
        dynamoClient: fastify.dynamoClient,
        entry: {
          module: Modules.AUDIT_LOG,
          actor: request.username!,
          target: module,
          message: `Viewed audit log from ${start} to ${end}.`,
        },
      });
      const queryCommand = new QueryCommand({
        TableName: genericConfig.AuditLogTable,
        KeyConditionExpression: "#pk = :module AND #sk BETWEEN :start AND :end",
        ExpressionAttributeNames: {
          "#pk": "module",
          "#sk": "createdAt",
        },
        ExpressionAttributeValues: {
          ":module": { S: module },
          ":start": { N: start.toString() },
          ":end": { N: end.toString() },
        },
        ScanIndexForward: false,
      });
      let response;
      try {
        response = await fastify.dynamoClient.send(queryCommand);
        if (!response.Items) {
          throw new DatabaseFetchError({
            message: "Error occurred fetching audit log.",
          });
        }
      } catch (e) {
        if (e instanceof BaseError) {
          throw e;
        }
        fastify.log.error(e);
        throw new DatabaseFetchError({
          message: "Error occurred fetching audit log.",
        });
      }
      await logPromise;
      reply.send(response.Items.map((x) => unmarshall(x)));
    },
  );
};

export default logsPlugin;
