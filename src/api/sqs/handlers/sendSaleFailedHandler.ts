import { AvailableSQSFunctions } from "common/types/sqsMessage.js";
import { currentEnvironmentConfig, SQSHandlerFunction } from "../index.js";
import { SESClient } from "@aws-sdk/client-ses";
import { generateSaleFailedEmail } from "api/functions/ses.js";
import { genericConfig } from "common/config.js";

export const sendSaleFailedHandler: SQSHandlerFunction<
  AvailableSQSFunctions.SendSaleFailedEmail
> = async (payload, _metadata, logger) => {
  const senderEmail = `sales@${currentEnvironmentConfig.EmailDomain}`;
  logger.info("Constructing email...");
  const emailCommand = generateSaleFailedEmail(
    payload.userId,
    senderEmail,
    payload.failureReason,
  );
  logger.info("Sending email...");
  const sesClient = new SESClient({ region: genericConfig.SesRegion });
  const response = await sesClient.send(emailCommand);
  logger.info("Sent!");
  return response;
};
