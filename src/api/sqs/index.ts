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
import { z, ZodError } from "zod";
import pino from "pino";
import { emailMembershipPassHandler, pingHandler } from "./handlers.js";
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
) => Promise<any>;

const handlers: SQSFunctionPayloadTypes = {
  [AvailableSQSFunctions.EmailMembershipPass]: emailMembershipPassHandler,
  [AvailableSQSFunctions.Ping]: pingHandler,
};
export const runEnvironment = process.env.RunEnvironment as RunEnvironment;
export const currentEnvironmentConfig = environmentConfig[runEnvironment];

export const handler = middy()
  .use(eventNormalizerMiddleware())
  .use(sqsPartialBatchFailure())
  .handler((event: SQSEvent, context: Context, { signal }) => {
    const recordsPromises = event.Records.map(async (record, index) => {
      try {
        let parsedBody = parseSQSPayload(record.body);
        if (parsedBody instanceof ZodError) {
          logger.error(
            { sqsMessageId: record.messageId },
            parsedBody.toString(),
          );
          throw new ValidationError({
            message: "Could not parse SQS payload",
          });
        }
        parsedBody = parsedBody as AnySQSPayload;
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
      } catch (e: any) {
        logger.error({ sqsMessageId: record.messageId }, e.toString());
        throw e;
      }
    });
    return Promise.allSettled(recordsPromises);
  });
