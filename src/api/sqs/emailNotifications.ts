import { AvailableSQSFunctions } from "common/types/sqsMessage.js";
import { currentEnvironmentConfig, SQSHandlerFunction } from "./index.js";
import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";
import { genericConfig } from "common/config.js";

const stripHtml = (html: string): string => {
  return html
    .replace(/<[^>]*>/g, "") // Remove HTML tags
    .replace(/&nbsp;/g, " ") // Replace non-breaking spaces
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
};

export const emailNotificationsHandler: SQSHandlerFunction<
  AvailableSQSFunctions.EmailNotifications
> = async (payload, metadata, logger) => {
  const { to, cc, bcc, content, subject } = payload;
  const senderEmail = `notifications@${currentEnvironmentConfig["EmailDomain"]}`;
  logger.info("Constructing email...");
  const command = new SendEmailCommand({
    Source: senderEmail,
    Destination: {
      ToAddresses: to,
      CcAddresses: cc || [],
      BccAddresses: bcc || [],
    },
    Message: {
      Subject: {
        Data: subject,
        Charset: "UTF-8",
      },
      Body: {
        Html: {
          Data: content,
          Charset: "UTF-8",
        },
        Text: {
          Data: stripHtml(content),
          Charset: "UTF-8",
        },
      },
    },
  });
  const sesClient = new SESClient({ region: genericConfig.AwsRegion });
  const response = await sesClient.send(command);
  logger.info("Sent!");
  logger.info(
    {
      type: "audit",
      module: "emailNotification",
      actor: metadata.initiator,
      reqId: metadata.reqId,
      target: to,
    },
    `Sent email notification with subject "${subject}".`,
  );
  return response;
};
