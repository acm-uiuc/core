import { SendMessageBatchCommand, SQSClient } from "@aws-sdk/client-sqs";
import { randomUUID } from "crypto";
import { FastifyBaseLogger } from "fastify";

interface SendBatchesParams {
  sqsClient: SQSClient;
  queueUrl: string;
  sqsPayloads: Record<any, any>;
  logger: FastifyBaseLogger;
}

export async function sendSqsMessagesInBatches({
  sqsClient,
  sqsPayloads,
  logger,
  queueUrl,
}: SendBatchesParams) {
  if (!sqsPayloads || sqsPayloads.length === 0) {
    return;
  }

  logger.debug(`Sending ${sqsPayloads.length} messages.`);
  for (let i = 0; i < sqsPayloads.length; i += 10) {
    const chunk = sqsPayloads.slice(i, i + 10);
    await sqsClient.send(
      new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: chunk.map((payload: any) => ({
          Id: randomUUID(),
          MessageBody: JSON.stringify(payload),
        })),
      }),
    );
  }
  logger.info(`Finished sending ${sqsPayloads.length} messages.`);
}
