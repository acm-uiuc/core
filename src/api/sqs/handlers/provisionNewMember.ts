import { AvailableSQSFunctions } from "common/types/sqsMessage.js";
import { currentEnvironmentConfig, SQSHandlerFunction } from "../index.js";
import {
  getEntraIdToken,
  getUserProfile,
} from "../../../api/functions/entraId.js";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { genericConfig } from "../../../common/config.js";

import { setPaidMembership } from "api/functions/membership.js";
import { createAuditLogEntry } from "api/functions/auditLog.js";
import { Modules } from "common/modules.js";
import { getAuthorizedClients } from "../utils.js";
import { emailMembershipPassHandler } from "./emailMembershipPassHandler.js";

export const provisionNewMemberHandler: SQSHandlerFunction<
  AvailableSQSFunctions.ProvisionNewMember
> = async (payload, metadata, logger) => {
  const { email } = payload;
  const commonConfig = { region: genericConfig.AwsRegion };
  const clients = await getAuthorizedClients(logger, commonConfig);
  const entraToken = await getEntraIdToken(
    clients,
    currentEnvironmentConfig.AadValidClientId,
  );
  logger.info("Got authorized clients and Entra ID token.");
  const { updated } = await setPaidMembership({
    netId: email.replace("@illinois.edu", ""),
    dynamoClient: clients.dynamoClient,
    entraToken,
    paidMemberGroup: currentEnvironmentConfig.PaidMemberGroupId,
  });
  if (updated) {
    const logPromise = createAuditLogEntry({
      entry: {
        module: Modules.PROVISION_NEW_MEMBER,
        actor: metadata.initiator,
        target: email,
        message: "Marked target as a paid member.",
      },
    });
    logger.info(
      `${email} added as a paid member. Emailing their membership pass.`,
    );
    await emailMembershipPassHandler(payload, metadata, logger);
    await logPromise;
  } else {
    logger.info(`${email} was already a paid member.`);
  }
};
