import { AvailableSQSFunctions } from "common/types/sqsMessage.js";
import { SQSHandlerFunction } from "../index.js";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { genericConfig } from "common/config.js";
import {
  deliverSubscriberCallback,
  SubscriberCallbackBlockedError,
} from "api/functions/subscriberCallback.js";

export const stripeLinkSubscriberCallbackHandler: SQSHandlerFunction<
  AvailableSQSFunctions.StripeLinkSubscriberCallback
> = async (payload, _metadata, logger) => {
  const dynamoClient = new DynamoDBClient({ region: genericConfig.AwsRegion });
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
  if (!response.Items || response.Items.length !== 1) {
    logger.warn(
      { linkId: payload.linkId },
      "Stripe link not found for subscriber callback; dropping message.",
    );
    return;
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
  try {
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
  } catch (error) {
    if (error instanceof SubscriberCallbackBlockedError) {
      logger.error(
        { error: error.message, linkId: payload.linkId },
        "Subscriber callback blocked; dropping (not retrying).",
      );
      return;
    }
    throw error;
  }
};
