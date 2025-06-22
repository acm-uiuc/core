import { AvailableSQSFunctions } from "common/types/sqsMessage.js";
import { currentEnvironmentConfig, SQSHandlerFunction } from "../index.js";
import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";
import { genericConfig } from "common/config.js";
import { createAuditLogEntry } from "api/functions/auditLog.js";
import { Modules } from "common/modules.js";
import Handlebars from "handlebars";
import emailTemplate from "./templates/notification.js";

Handlebars.registerHelper("nl2br", (text) => {
  let nl2br = `${text}`.replace(/([^>\r\n]?)(\r\n|\n\r|\r|\n)/g, "$1<br>$2");
  nl2br = `<p>${nl2br.replace(/<br>/g, "</p><p>")}</p>`;
  return new Handlebars.SafeString(nl2br);
});

const compiledTemplate = Handlebars.compile(emailTemplate);

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
  const senderEmailAddress = `notifications@${currentEnvironmentConfig.EmailDomain}`;
  const senderEmail = `ACM @ UIUC <${senderEmailAddress}>`;
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
          Data: compiledTemplate({
            ...payload,
            id: metadata.reqId,
            from: senderEmailAddress,
          }),
          Charset: "UTF-8",
        },
        Text: {
          Data: stripHtml(content),
          Charset: "UTF-8",
        },
      },
    },
  });
  const logPromise = createAuditLogEntry({
    entry: {
      module: Modules.EMAIL_NOTIFICATION,
      actor: metadata.initiator,
      target: to.join(";"),
      message: `Sent email notification with subject "${subject}".`,
    },
  });
  const sesClient = new SESClient({ region: genericConfig.AwsRegion });
  const response = await sesClient.send(command);
  logger.info("Sent!");
  await logPromise;
  return response;
};
