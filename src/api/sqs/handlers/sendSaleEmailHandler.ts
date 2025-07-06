import { AvailableSQSFunctions } from "common/types/sqsMessage.js";
import { currentEnvironmentConfig, SQSHandlerFunction } from "../index.js";
import { SESClient } from "@aws-sdk/client-ses";
import QRCode from "qrcode";
import { generateSalesEmail } from "api/functions/ses.js";
import { genericConfig } from "common/config.js";

export const sendSaleEmailHandler: SQSHandlerFunction<
  AvailableSQSFunctions.SendSaleEmail
> = async (payload, _metadata, logger) => {
  const { qrCodeContent } = payload;
  const senderEmail = `sales@${currentEnvironmentConfig.EmailDomain}`;
  logger.info("Constructing QR Code...");
  const qrCode = await QRCode.toBuffer(qrCodeContent, {
    errorCorrectionLevel: "H",
  });
  logger.info("Constructing email...");
  const emailCommand = generateSalesEmail(payload, senderEmail, qrCode.buffer);
  logger.info("Constructing email...");
  const sesClient = new SESClient({ region: genericConfig.AwsRegion });
  const response = await sesClient.send(emailCommand);
  logger.info("Sent!");
  return response;
};
