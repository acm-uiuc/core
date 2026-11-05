import { FastifyPluginAsync } from "fastify";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import * as z from "zod/v4";
import rateLimiter from "api/plugins/rateLimiter.js";
import { withRoles, withTags } from "api/components/index.js";
import {
  BaseError,
  DatabaseInsertError,
  NotImplementedError,
} from "common/errors/index.js";
import { AppRoles } from "common/roles.js";
import { assertAuthenticated } from "api/authenticated.js";
import { TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { genericConfig } from "common/config.js";
import { buildAuditLogTransactPut } from "api/functions/auditLog.js";
import { Modules } from "common/modules.js";
import {
  FUNDING_REQUEST_RETENTION_DAYS,
  FUNDING_REQUEST_RETENTION_DAYS_QA,
} from "common/constants.js";
import {
  fundingRequestCreateSchema,
  fundingRequestListQuery,
  fundingRequestListResponse,
  fundingRequestPostResponse,
  FundingRequestStatus,
} from "common/types/fundingRequest.js";
import {
  getFundingRequestScope,
  listFundingRequests,
} from "api/functions/fundingRequests.js";
import {
  assertLeadsOrg,
  computeExpiresAt,
} from "api/functions/requestWorkflow.js";

// TODO: the remaining endpoints still use [] (any authenticated user) until
// they are implemented with their own roles.

const requestIdParams = z.object({
  requestId: z.string().min(1).meta({
    description: "Funding request ID.",
    example: "6667e095-8b04-4877-b361-f636f459ba42",
  }),
});

const fundingRequestRoutes: FastifyPluginAsync = async (fastify, _options) => {
  await fastify.register(rateLimiter, {
    limit: 20,
    duration: 30,
    rateLimitIdentifier: "fundingRequests",
  });

  // POST /fundingRequests — create a new funding request
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "",
    {
      schema: withRoles(
        // Every org lead gets this meta role automatically. The handler then
        // checks that they lead the specific org in the body.
        [AppRoles.AT_LEAST_ONE_ORG_MANAGER],
        withTags(["Funding Requests"], {
          summary: "Create a new funding request.",
          body: fundingRequestCreateSchema,
          response: {
            201: {
              description: "The funding request was created.",
              content: {
                "application/json": {
                  schema: fundingRequestPostResponse,
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      const { orgId, semesterId, title, description, requestedAmountCents } =
        request.body;
      await assertLeadsOrg({
        fastify,
        request,
        orgId,
        action: "create funding requests for it",
      });

      const requestId = request.id;
      const createdAt = new Date().toISOString();
      const expiresAt = computeExpiresAt({
        runEnvironment: fastify.runEnvironment,
        prodDays: FUNDING_REQUEST_RETENTION_DAYS,
        qaDays: FUNDING_REQUEST_RETENTION_DAYS_QA,
      });
      // One attribute per column in the main table schema. approvedAmountCents
      // is left out until the treasurer approves the request.
      const mainRow = {
        semesterId,
        "orgId#requestId": `${orgId}#${requestId}`,
        requestId,
        orgId,
        title,
        description,
        requestedAmountCents,
        currentStatus: FundingRequestStatus.SUBMITTED,
        createdBy: request.username,
        createdAt,
        updatedAt: createdAt,
        expiresAt,
      };
      const historyRow = {
        requestId,
        "createdAt#status": `${createdAt}#${FundingRequestStatus.SUBMITTED}`,
        status: FundingRequestStatus.SUBMITTED,
        semesterId,
        createdBy: request.username,
        notes: "Request submitted.",
        expiresAt,
      };
      const logStatement = buildAuditLogTransactPut({
        entry: {
          module: Modules.FUNDING_REQUESTS,
          actor: request.username,
          target: `${semesterId}/${requestId}`,
          requestId: request.id,
          message: `Created funding request "${title}".`,
        },
      });

      try {
        await fastify.dynamoClient.send(
          new TransactWriteItemsCommand({
            TransactItems: [
              {
                Put: {
                  TableName: genericConfig.FundingRequestsTableName,
                  Item: marshall(mainRow, { removeUndefinedValues: true }),
                  // Never overwrite an existing request.
                  ConditionExpression: "attribute_not_exists(requestId)",
                },
              },
              {
                Put: {
                  TableName: genericConfig.FundingRequestsStatusTableName,
                  Item: marshall(historyRow, { removeUndefinedValues: true }),
                },
              },
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
          message: "Could not save funding request.",
        });
      }

      return reply.status(201).send({
        id: requestId,
        status: FundingRequestStatus.SUBMITTED,
      });
    }),
  );

  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "",
    {
      schema: withRoles(
        [AppRoles.FUNDING_REQUEST_VIEW_ALL, AppRoles.AT_LEAST_ONE_ORG_MANAGER],
        withTags(["Funding Requests"], {
          summary: "List funding requests the user can access.",
          querystring: fundingRequestListQuery,
          response: {
            200: {
              description: "The funding requests the user can access.",
              content: {
                "application/json": {
                  schema: fundingRequestListResponse,
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      const scope = await getFundingRequestScope({
        username: request.username,
        userRoles: request.userRoles,
        dynamoClient: fastify.dynamoClient,
        logger: request.log,
      });
      if (scope !== "all" && scope.length === 0) {
        return reply.status(200).send([]);
      }
      const items = await listFundingRequests({
        semesterId: request.query.semesterId,
        scope,
        dynamoClient: fastify.dynamoClient,
      });
      return reply.status(200).send(items);
    }),
  );

  // GET /fundingRequests/:requestId — view one funding request
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/:requestId",
    {
      schema: withRoles(
        [],
        withTags(["Funding Requests"], {
          summary: "Get a single funding request.",
          params: requestIdParams,
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (_request, _reply) => {
      throw new NotImplementedError({});
    },
  );

  // PATCH /fundingRequests/:requestId — edit request info (requester, treasurer)
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().patch(
    "/:requestId",
    {
      schema: withRoles(
        [],
        withTags(["Funding Requests"], {
          summary: "Edit a funding request.",
          params: requestIdParams,
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (_request, _reply) => {
      throw new NotImplementedError({});
    },
  );

  // PATCH /fundingRequests/:requestId/status — update status (treasurer)
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().patch(
    "/:requestId/status",
    {
      schema: withRoles(
        [],
        withTags(["Funding Requests"], {
          summary: "Update the status of a funding request.",
          params: requestIdParams,
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (_request, _reply) => {
      throw new NotImplementedError({});
    },
  );

  // GET /fundingRequests/:requestId/history — view edit history
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/:requestId/history",
    {
      schema: withRoles(
        [],
        withTags(["Funding Requests"], {
          summary: "Get the edit history of a funding request.",
          params: requestIdParams,
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (_request, _reply) => {
      throw new NotImplementedError({});
    },
  );

  // DELETE /fundingRequests/:requestId — delete/cancel a request
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().delete(
    "/:requestId",
    {
      schema: withRoles(
        [],
        withTags(["Funding Requests"], {
          summary: "Delete or cancel a funding request.",
          params: requestIdParams,
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (_request, _reply) => {
      throw new NotImplementedError({});
    },
  );
};

export default fundingRequestRoutes;
