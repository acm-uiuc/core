import middy from "@middy/core";
import eventNormalizerMiddleware from "@middy/event-normalizer";
import sqsPartialBatchFailure from "@middy/sqs-partial-batch-failure";
import { Context, SQSEvent } from "aws-lambda";
import {
  parseSQSPayload,
  sqsPayloadSchemas,
  AvailableSQSFunctions,
  SQSMessageMetadata,
  AnySQSPayload,
} from "../../common/types/sqsMessage.js";
import { logger } from "./logger.js";
import * as z from "zod/v4";
import pino from "pino";
import {
  emailMembershipPassHandler,
  pingHandler,
  provisionNewMemberHandler,
  sendSaleEmailHandler,
  emailNotificationsHandler,
  createOrgGithubTeamHandler,
  syncExecCouncilHandler,
  processStorePurchaseHandler,
  sendSaleFailedHandler,
} from "./handlers/index.js";
import { ValidationError } from "../../common/errors/index.js";
import { RunEnvironment } from "../../common/roles.js";
import { environmentConfig } from "../../common/config.js";

export type SQSFunctionPayloadTypes = {
  [K in keyof typeof sqsPayloadSchemas]: SQSHandlerFunction<K>;
};

export type SQSHandlerFunction<T extends AvailableSQSFunctions> = (
  payload: z.infer<(typeof sqsPayloadSchemas)[T]>["payload"],
  metadata: SQSMessageMetadata,
  logger: pino.Logger,
) => Promise<object | void>;

const handlers: SQSFunctionPayloadTypes = {
  [AvailableSQSFunctions.EmailMembershipPass]: emailMembershipPassHandler,
  [AvailableSQSFunctions.Ping]: pingHandler,
  [AvailableSQSFunctions.ProvisionNewMember]: provisionNewMemberHandler,
  [AvailableSQSFunctions.SendSaleEmail]: sendSaleEmailHandler,
  [AvailableSQSFunctions.EmailNotifications]: emailNotificationsHandler,
  [AvailableSQSFunctions.CreateOrgGithubTeam]: createOrgGithubTeamHandler,
  [AvailableSQSFunctions.SyncExecCouncil]: syncExecCouncilHandler,
  [AvailableSQSFunctions.HandleStorePurchase]: processStorePurchaseHandler,
  [AvailableSQSFunctions.SendSaleFailedEmail]: sendSaleFailedHandler,
};
export const runEnvironment = process.env.RunEnvironment as RunEnvironment;
export const currentEnvironmentConfig = environmentConfig[runEnvironment];
const restrictedQueues: Record<string, AvailableSQSFunctions[]> = {
  "infra-core-api-sqs-sales": [AvailableSQSFunctions.SendSaleEmail],
};

export const handler = middy()
  .use(eventNormalizerMiddleware())
  .use(sqsPartialBatchFailure())
  .handler((event: unknown, _context: Context, { signal: _signal }) => {
    const recordsPromises = (event as SQSEvent).Records.map(
      async (record, _index) => {
        const sourceQueue = record.eventSourceARN.split(":").slice(-1)[0];
        try {
          let parsedBody = parseSQSPayload(record.body);
          if (parsedBody instanceof z.ZodError) {
            logger.error(
              { sqsMessageId: record.messageId },
              parsedBody.toString(),
            );
            throw new ValidationError({
              message: "Could not parse SQS payload",
            });
          }
          parsedBody = parsedBody as AnySQSPayload;
          if (
            restrictedQueues[sourceQueue]?.includes(parsedBody.function) ===
            false
          ) {
            throw new ValidationError({
              message: `Queue ${sourceQueue} is not permitted to call the function ${parsedBody.function}!`,
            });
          }
          const childLogger = logger.child({
            sqsMessageId: record.messageId,
            metadata: parsedBody.metadata,
            function: parsedBody.function,
          });
          const func = handlers[parsedBody.function] as SQSHandlerFunction<
            typeof parsedBody.function
          >;

          childLogger.info(`Starting handler for ${parsedBody.function}...`);
          const result = func(
            parsedBody.payload,
            parsedBody.metadata,
            childLogger,
          );
          childLogger.info(`Finished handler for ${parsedBody.function}.`);
          return result;
        } catch (e: unknown) {
          if (!(e instanceof Error)) {
            logger.error(
              { sqsMessageId: record.messageId },
              "An unknown-type error occurred.",
            );
            throw e;
          }
          logger.error({ sqsMessageId: record.messageId }, e.toString());
          throw e;
        }
      },
    );
    return Promise.allSettled(recordsPromises);
  });
