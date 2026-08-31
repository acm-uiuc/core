import { AvailableSQSFunctions } from "common/types/sqsMessage.js";
import { SQSHandlerFunction } from "../index.js";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { genericConfig } from "common/config.js";
import { deliverSubscriberCallback } from "api/functions/subscriberCallback.js";

const dynamoClient = new DynamoDBClient({ region: genericConfig.AwsRegion });

export const stripeLinkSubscriberCallbackHandler: SQSHandlerFunction<
  AvailableSQSFunctions.StripeLinkSubscriberCallback
> = async (payload, _metadata, logger) => {
  const response = await dynamoClient.send(
    new QueryCommand({
      TableName: genericConfig.StripeLinksDynamoTableName,
      IndexName: "LinkIdIndex",
      KeyConditionExpression: "linkId = :linkId",
      ExpressionAttributeValues: {
        ":linkId": { S: payload.linkId },
      },
    }),
  );
  if (!response.Items || response.Items.length === 0) {
    logger.warn(
      { linkId: payload.linkId },
      "Stripe link not found for subscriber callback, retrying.",
    );
    throw new Error("Stripe link not found for subscriber callback, retrying");
  }

  if (response.Items.length !== 1) {
    // Each row carries its own callbackUrl and signingSecret, so picking one
    // arbitrarily could send payment details to the wrong subscriber. Fail
    // instead, and let the message land in the DLQ for investigation.
    logger.error(
      { linkId: payload.linkId, itemCount: response.Items.length },
      "Multiple Stripe links found for subscriber callback; refusing to deliver.",
    );
    throw new Error(
      `Multiple Stripe links found for linkId ${payload.linkId}; refusing to deliver.`,
    );
  }
  const entry = unmarshall(response.Items[0]) as {
    callbackUrl?: string;
    signingSecret?: string;
  };
  if (!entry.callbackUrl || !entry.signingSecret) {
    logger.info(
      { linkId: payload.linkId },
      "Stripe link has no callbackUrl/signingSecret; dropping message.",
    );
    return;
  }
  await deliverSubscriberCallback({
    callbackUrl: entry.callbackUrl,
    signingSecret: entry.signingSecret,
    eventId: payload.eventId,
    body: {
      type: payload.eventType,
      eventId: payload.eventId,
      linkId: payload.linkId,
      invoiceId: payload.invoiceId,
      amount: payload.amount,
      currency: payload.currency,
      paidInFull: payload.paidInFull,
      paymentMethod: payload.paymentMethod ?? null,
      payerName: payload.payerName ?? null,
      payerEmail: payload.payerEmail ?? null,
      occurredAt: payload.occurredAt,
    },
    logger,
  });
};
