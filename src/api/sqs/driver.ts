import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { environmentConfig, genericConfig } from "common/config.js";
import {
  AvailableSQSFunctions,
  parseSQSPayload,
} from "common/types/sqsMessage.js";

const queueUrl = environmentConfig.dev.SqsQueueUrl;
const sqsClient = new SQSClient({
  region: genericConfig.AwsRegion,
});

const payload = parseSQSPayload({
  function: AvailableSQSFunctions.Ping,
  payload: {},
  metadata: {
    reqId: "1",
    initiator: "dsingh14@illinois.edu",
  },
});
if (!payload) {
  throw new Error("not valid");
}
const command = new SendMessageCommand({
  QueueUrl: queueUrl,
  MessageBody: JSON.stringify(payload),
});

await sqsClient.send(command);
