import { FastifyPluginAsync } from "fastify";
import {
  InternalServerError,
  UnauthenticatedError,
  ValidationError,
} from "../../common/errors/index.js";
import { z } from "zod";
import { checkPaidMembershipFromTable } from "../functions/membership.js";
import {
  AvailableSQSFunctions,
  SQSPayload,
} from "../../common/types/sqsMessage.js";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { genericConfig } from "../../common/config.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import rateLimiter from "api/plugins/rateLimiter.js";

const queuedResponseJsonSchema = zodToJsonSchema(
  z.object({
    queueId: z.string().uuid(),
  }),
);

const mobileWalletRoute: FastifyPluginAsync = async (fastify, _options) => {
  fastify.register(rateLimiter, {
    limit: 5,
    duration: 30,
    rateLimitIdentifier: "mobileWallet",
  });
  fastify.post<{ Querystring: { email: string } }>(
    "/membership",
    {
      schema: {
        response: { 202: queuedResponseJsonSchema },
        querystring: {
          type: "object",
          properties: {
            email: { type: "string", format: "email" },
          },
          required: ["email"],
        },
      },
    },
    async (request, reply) => {
      if (!request.query.email) {
        throw new UnauthenticatedError({ message: "Could not find user." });
      }
      try {
        await z
          .string()
          .email()
          .refine(
            (email) => email.endsWith("@illinois.edu"),
            "Email must be on the illinois.edu domain.",
          )
          .parseAsync(request.query.email);
      } catch {
        throw new ValidationError({
          message: "Email query parameter is not a valid email",
        });
      }
      const isPaidMember =
        (fastify.runEnvironment === "dev" &&
          request.query.email === "testinguser@illinois.edu") ||
        (await checkPaidMembershipFromTable(
          request.query.email.replace("@illinois.edu", ""),
          fastify.dynamoClient,
        ));
      if (!isPaidMember) {
        throw new UnauthenticatedError({
          message: `${request.query.email} is not a paid member.`,
        });
      }
      const sqsPayload: SQSPayload<AvailableSQSFunctions.EmailMembershipPass> =
        {
          function: AvailableSQSFunctions.EmailMembershipPass,
          metadata: {
            initiator: "public",
            reqId: request.id,
          },
          payload: {
            email: request.query.email,
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
          message: "Could not add job to queue.",
        });
      }
      request.log.info(`Queued job to SQS with message ID ${result.MessageId}`);
      reply.status(202).send({ queueId: result.MessageId });
    },
  );
};

export default mobileWalletRoute;
