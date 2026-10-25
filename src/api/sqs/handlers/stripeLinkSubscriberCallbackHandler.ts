import { AvailableSQSFunctions } from "common/types/sqsMessage.js";
import {
  currentEnvironmentConfig,
  runEnvironment,
  SQSHandlerFunction,
} from "../index.js";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { genericConfig, SecretConfig } from "common/config.js";
import { SQSClient } from "@aws-sdk/client-sqs";
import { getSecretConfig } from "../utils.js";
import { deliverSubscriberCallback } from "api/functions/subscriberCallback.js";
import { getStripeLinkRoute } from "api/functions/ramp/records.js";
import { processStripeLinkSettlement } from "api/functions/ramp/settlement.js";

// Targeted callbacks retain their immutable destination even after the
// presentation row expires; ordinary callbacks keep the existing index lookup.
const settlementDynamoClient = new DynamoDBClient({
  region: "us-east-2",
  maxAttempts: 1,
});
const dynamoClient = new DynamoDBClient({ region: genericConfig.AwsRegion });

export const stripeLinkSubscriberCallbackHandler: SQSHandlerFunction<
  AvailableSQSFunctions.StripeLinkSubscriberCallback
> = async (payload, _metadata, logger, context) => {
  const remaining = context?.getRemainingTimeInMillis?.();
  const deadline =
    remaining === undefined ? undefined : Date.now() + remaining - 5_000;

  const route = await getStripeLinkRoute({
    dynamoClient: settlementDynamoClient,
    linkId: payload.linkId,
    deadline,
  });

  let callbackUrl: string | undefined;
  let signingSecret: string | undefined;
  if (route) {
    callbackUrl = route.callbackUrl;
    signingSecret = route.signingSecret;
  } else {
    const response = await dynamoClient.send(
      new QueryCommand({
        TableName: genericConfig.StripeLinksDynamoTableName,
        IndexName: "LinkIdIndex",
        KeyConditionExpression: "linkId = :linkId",
        ExpressionAttributeValues: {
          ":linkId": { S: payload.linkId },
        },
      }),
      deadline === undefined
        ? undefined
        : {
            abortSignal: AbortSignal.timeout(
              Math.max(1, deadline - Date.now()),
            ),
          },
    );
    if (!response.Items || response.Items.length === 0) {
      logger.warn(
        { linkId: payload.linkId },
        "Stripe link not found for subscriber callback, retrying.",
      );
      throw new Error(
        "Stripe link not found for subscriber callback, retrying",
      );
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
    callbackUrl = entry.callbackUrl;
    signingSecret = entry.signingSecret;
  }

  if (!callbackUrl || !signingSecret) {
    logger.info(
      { linkId: payload.linkId },
      "Stripe link has no callbackUrl/signingSecret; dropping message.",
    );
    return;
  }
  await deliverSubscriberCallback({
    callbackUrl,
    signingSecret,
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
export const processStripeLinkSettlementHandler: SQSHandlerFunction<
  AvailableSQSFunctions.ProcessStripeLinkSettlement
> = async (payload, metadata, logger, context) => {
  const secretConfig: SecretConfig = await getSecretConfig({
    logger,
    commonConfig: { region: genericConfig.AwsRegion },
  });
  const sqsClient = new SQSClient({ region: genericConfig.AwsRegion });
  await processStripeLinkSettlement({
    dynamoClient: settlementDynamoClient,
    sqsClient,
    secretConfig,
    environmentConfig: currentEnvironmentConfig,
    runEnvironment,
    key: payload,
    metadata,
    logger,
    remainingTimeInMillis: context?.getRemainingTimeInMillis,
  });
};
