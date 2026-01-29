import { AvailableSQSFunctions } from "common/types/sqsMessage.js";
import { currentEnvironmentConfig, SQSHandlerFunction } from "../index.js";
import { processStorePaymentSuccess } from "api/functions/store.js";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { genericConfig, type SecretConfig } from "common/config.js";
import { getSecretConfig } from "../utils.js";

export const processStorePurchaseHandler: SQSHandlerFunction<
  AvailableSQSFunctions.HandleStorePurchase
> = async (payload, metadata, logger) => {
  const commonConfig = { region: genericConfig.AwsRegion };

  const secretConfig: SecretConfig = await getSecretConfig({
    logger,
    commonConfig,
  });

  const dynamoClient = new DynamoDBClient(commonConfig);
  logger.info("Calling store payment success handler!");
  await processStorePaymentSuccess({
    ...payload,
    requestId: metadata.reqId,
    eventId: metadata.initiator,
    dynamoClient,
    stripeApiKey: secretConfig.stripe_secret_key,
    logger,
    sqsQueueUrl: currentEnvironmentConfig.SqsQueueUrl,
  });
};
