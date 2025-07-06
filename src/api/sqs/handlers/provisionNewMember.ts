import { AvailableSQSFunctions } from "common/types/sqsMessage.js";
import { currentEnvironmentConfig, SQSHandlerFunction } from "../index.js";
import { getEntraIdToken } from "../../../api/functions/entraId.js";
import { genericConfig, SecretConfig } from "../../../common/config.js";

import {
  MEMBER_CACHE_SECONDS,
  setPaidMembership,
} from "api/functions/membership.js";
import { createAuditLogEntry } from "api/functions/auditLog.js";
import { Modules } from "common/modules.js";
import { getAuthorizedClients, getSecretConfig } from "../utils.js";
import { emailMembershipPassHandler } from "./emailMembershipPassHandler.js";
import RedisModule from "ioredis";
import { setKey } from "api/functions/redisCache.js";

export const provisionNewMemberHandler: SQSHandlerFunction<
  AvailableSQSFunctions.ProvisionNewMember
> = async (payload, metadata, logger) => {
  const { email, firstName, lastName } = payload;
  const commonConfig = { region: genericConfig.AwsRegion };
  const clients = await getAuthorizedClients(logger, commonConfig);
  const entraToken = await getEntraIdToken({
    clients: { ...clients },
    clientId: currentEnvironmentConfig.AadValidClientId,
    secretName: genericConfig.EntraSecretName,
    logger,
  });
  const secretConfig: SecretConfig = await getSecretConfig({
    logger,
    commonConfig,
  });
  const redisClient = new RedisModule.default(secretConfig.redis_url);
  const netId = email.replace("@illinois.edu", "");
  const cacheKey = `membership:${netId}:acmpaid`;
  logger.info("Got authorized clients and Entra ID token.");
  const { updated } = await setPaidMembership({
    netId,
    dynamoClient: clients.dynamoClient,
    entraToken,
    paidMemberGroup: currentEnvironmentConfig.PaidMemberGroupId,
    firstName,
    lastName,
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
  logger.info("Setting membership in Redis.");
  await setKey({
    redisClient,
    key: cacheKey,
    data: JSON.stringify({ isMember: true }),
    expiresIn: MEMBER_CACHE_SECONDS,
    logger,
  });
};
