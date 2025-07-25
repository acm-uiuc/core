import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { withRoles, withTags } from "api/components/index.js";
import { createAuditLogEntry } from "api/functions/auditLog.js";
import rateLimiter from "api/plugins/rateLimiter.js";
import { genericConfig } from "common/config.js";
import { BaseError, DatabaseFetchError } from "common/errors/index.js";
import { Modules } from "common/modules.js";
import { AppRoles } from "common/roles.js";
import { loggingEntryFromDatabase } from "common/types/logs.js";
import { FastifyPluginAsync } from "fastify";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import * as z from "zod/v4";

const responseSchema = z.array(loggingEntryFromDatabase);
type ResponseType = z.infer<typeof responseSchema>;

const logsPlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.register(rateLimiter, {
    limit: 10,
    duration: 30,
    rateLimitIdentifier: "logs",
  });
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/:module",
    {
      schema: withRoles(
        [AppRoles.AUDIT_LOG_VIEWER],
        withTags(["Logging"], {
          querystring: z
            .object({
              start: z.coerce.number().meta({
                description:
                  "Epoch timestamp for the start of the search range",
                example: 1745114772,
              }),
              end: z.coerce.number().meta({
                description: "Epoch timestamp for the end of the search range",
                example: 1745201172,
              }),
            })
            .refine((data) => data.start <= data.end, {
              message: "Start time must be less than or equal to end time",
              path: ["start"],
            }),
          params: z.object({
            module: z
              .nativeEnum(Modules)
              .meta({ description: "Module to get audit logs for." }),
          }),
          summary: "Retrieve audit logs for a module.",
          // response: { 200: responseSchema },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
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
      const resp = response.Items.map((x) => unmarshall(x)) as ResponseType;
      reply.send(resp);
    },
  );
};

export default logsPlugin;
