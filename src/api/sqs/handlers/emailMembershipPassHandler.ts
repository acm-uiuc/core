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
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

export const emailMembershipPassHandler: SQSHandlerFunction<
  AvailableSQSFunctions.EmailMembershipPass
> = async (payload, metadata, logger) => {
  const { email, firstName } = payload;
  const commonConfig = { region: genericConfig.SesRegion };
  const clients = await getAuthorizedClients(logger, {
    region: genericConfig.AwsRegion,
  });
  const entraIdToken = await getEntraIdToken({
    clients: { ...clients },
    clientId: currentEnvironmentConfig.AadValidClientId,
    logger,
  });
  const userProfile = await getUserProfile(entraIdToken, email);
  const pkpass = await issueAppleWalletMembershipCard(
    { smClient: new SecretsManagerClient({ region: genericConfig.AwsRegion }) },
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
    firstName,
  );
  if (runEnvironment === "dev" && email === "testinguser@illinois.edu") {
    return;
  }
  const sesClient = new SESClient(commonConfig);
  return await sesClient.send(emailCommand);
};
