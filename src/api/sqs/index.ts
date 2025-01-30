import middy from "@middy/core";
import eventNormalizerMiddleware from "@middy/event-normalizer";
import sqsPartialBatchFailure from "@middy/sqs-partial-batch-failure";
import { Context, SQSEvent } from "aws-lambda";
import {
  parseSQSPayload,
  SQSPayload,
  sqsPayloadSchemas,
  AvailableSQSFunctions,
  SQSMessageMetadata,
} from "../../common/types/sqsMessage.js";
import { logger } from "./logger.js";
import { z, ZodError } from "zod";
import pino from "pino";
import { emailMembershipPassHandler, pingHandler } from "./handlers.js";

export type SQSFunctionPayloadTypes = {
  [K in keyof typeof sqsPayloadSchemas]: SQSHandlerFunction<K>;
};

export type SQSHandlerFunction<T extends AvailableSQSFunctions> = (
  payload: z.infer<(typeof sqsPayloadSchemas)[T]>["payload"],
  metadata: SQSMessageMetadata,
  logger: pino.Logger,
) => Promise<void>;

const handlers: SQSFunctionPayloadTypes = {
  [AvailableSQSFunctions.EmailMembershipPass]: emailMembershipPassHandler,
  [AvailableSQSFunctions.Ping]: pingHandler,
};

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
        }
        parsedBody = parsedBody as SQSPayload;
        const childLogger = logger.child({
          sqsMessageId: record.messageId,
          metadata: parsedBody.metadata,
        });
        childLogger.info("Processing started.");
        const func = handlers[parsedBody.function] as SQSHandlerFunction<
          typeof parsedBody.function
        >;
        return func(parsedBody.payload, parsedBody.metadata, childLogger);
      } catch (e: any) {
        logger.error({ sqsMessageId: record.messageId }, e.toString());
      }
    });
    return Promise.allSettled(recordsPromises);
  });
