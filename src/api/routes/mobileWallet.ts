import { FastifyPluginAsync } from "fastify";
import {
  InternalServerError,
  UnauthenticatedError,
  ValidationError,
} from "../../common/errors/index.js";
import * as z from "zod/v4";
import { checkPaidMembershipFromTable } from "../functions/membership.js";
import {
  AvailableSQSFunctions,
  SQSPayload,
} from "../../common/types/sqsMessage.js";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { genericConfig } from "../../common/config.js";
import rateLimiter from "api/plugins/rateLimiter.js";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import { withTags } from "api/components/index.js";

const queuedResponseJsonSchema = z.object({
  queueId: z.string().uuid(),
});

const mobileWalletRoute: FastifyPluginAsync = async (fastify, _options) => {
  fastify.register(rateLimiter, {
    limit: 5,
    duration: 30,
    rateLimitIdentifier: "mobileWallet",
  });
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/membership",
    {
      schema: withTags(["Mobile Wallet"], {
        // response: { 202: queuedResponseJsonSchema },
        querystring: z
          .object({
            email: z.string().email(),
          })
          .refine((data) => data.email.endsWith("@illinois.edu"), {
            message: "Email must be on the illinois.edu domain.",
            path: ["email"],
          }),
        summary: "Email mobile wallet pass for ACM membership to user.",
      }),
    },
    async (request, reply) => {
      reply.header(
        "Deprecation",
        "The V1 endpoint will soon be deprecated. Please use the V2 endpoint moving forward.",
      );
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
            initiator: request.ip,
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
