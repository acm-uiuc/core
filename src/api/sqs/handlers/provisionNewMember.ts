import { AvailableSQSFunctions } from "common/types/sqsMessage.js";
import { currentEnvironmentConfig, SQSHandlerFunction } from "../index.js";
import {
  getEntraIdToken,
  getUserProfile,
} from "../../../api/functions/entraId.js";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { genericConfig, SecretConfig } from "../../../common/config.js";

import { setPaidMembership } from "api/functions/membership.js";
import { createAuditLogEntry } from "api/functions/auditLog.js";
import { Modules } from "common/modules.js";
import { getAuthorizedClients, getSecretConfig } from "../utils.js";
import { emailMembershipPassHandler } from "./emailMembershipPassHandler.js";
import Redis from "ioredis";

let secretConfig: SecretConfig;

export const provisionNewMemberHandler: SQSHandlerFunction<
  AvailableSQSFunctions.ProvisionNewMember
> = async (payload, metadata, logger) => {
  const { email } = payload;
  const commonConfig = { region: genericConfig.AwsRegion };
  const clients = await getAuthorizedClients(logger, commonConfig);
  if (!secretConfig) {
    secretConfig = await getSecretConfig({ logger, commonConfig });
  }
  const redisClient = new Redis.default(secretConfig.redis_url);
  const entraToken = await getEntraIdToken({
    clients: { ...clients, redisClient },
    clientId: currentEnvironmentConfig.AadValidClientId,
    secretName: genericConfig.EntraSecretName,
    encryptionSecret: secretConfig.encryption_key,
    logger,
  });
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
