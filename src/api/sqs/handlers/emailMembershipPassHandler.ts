import { AvailableSQSFunctions } from "common/types/sqsMessage.js";
import {
  currentEnvironmentConfig,
  runEnvironment,
  SQSHandlerFunction,
} from "../index.js";
import { environmentConfig, genericConfig } from "common/config.js";
import { getAuthorizedClients } from "../utils.js";
import { getEntraIdToken, getUserProfile } from "api/functions/entraId.js";
import { issueAppleWalletMembershipCard } from "api/functions/mobileWallet.js";
import { generateMembershipEmailCommand } from "api/functions/ses.js";
import { SESClient } from "@aws-sdk/client-ses";

export const emailMembershipPassHandler: SQSHandlerFunction<
  AvailableSQSFunctions.EmailMembershipPass
> = async (payload, metadata, logger) => {
  const email = payload.email;
  const commonConfig = { region: genericConfig.AwsRegion };
  const clients = await getAuthorizedClients(logger, commonConfig);
  const entraIdToken = await getEntraIdToken({
    clients: { ...clients },
    clientId: currentEnvironmentConfig.AadValidClientId,
    secretName: genericConfig.EntraSecretName,
    logger,
  });
  const userProfile = await getUserProfile(entraIdToken, email);
  const pkpass = await issueAppleWalletMembershipCard(
    clients,
    environmentConfig[runEnvironment],
    runEnvironment,
    email,
    metadata.initiator,
    logger,
    userProfile.displayName,
  );
  const emailCommand = generateMembershipEmailCommand(
    email,
    `membership@${environmentConfig[runEnvironment].EmailDomain}`,
    pkpass.buffer,
  );
  if (runEnvironment === "dev" && email === "testinguser@illinois.edu") {
    return;
  }
  const sesClient = new SESClient(commonConfig);
  return await sesClient.send(emailCommand);
};
