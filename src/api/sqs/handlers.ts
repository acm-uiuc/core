import { AvailableSQSFunctions } from "common/types/sqsMessage.js";
import {
  currentEnvironmentConfig,
  runEnvironment,
  SQSHandlerFunction,
} from "./index.js";
import {
  getEntraIdToken,
  getUserProfile,
} from "../../api/functions/entraId.js";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { environmentConfig, genericConfig } from "../../common/config.js";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { issueAppleWalletMembershipCard } from "../../api/functions/mobileWallet.js";
import { generateMembershipEmailCommand } from "../../api/functions/ses.js";
import { SESClient } from "@aws-sdk/client-ses";

export const emailMembershipPassHandler: SQSHandlerFunction<
  AvailableSQSFunctions.EmailMembershipPass
> = async (payload, _metadata, logger) => {
  const email = payload.email;
  const commonConfig = { region: genericConfig.AwsRegion };
  const clients = {
    smClient: new SecretsManagerClient(commonConfig),
    dynamoClient: new DynamoDBClient(commonConfig),
  };
  const entraIdToken = await getEntraIdToken(
    clients,
    currentEnvironmentConfig.AadValidClientId,
  );
  const userProfile = await getUserProfile(entraIdToken, email);
  const pkpass = await issueAppleWalletMembershipCard(
    clients,
    environmentConfig[runEnvironment],
    runEnvironment,
    email,
    logger,
    userProfile.displayName,
  );
  const emailCommand = generateMembershipEmailCommand(
    email,
    `membership@${environmentConfig[runEnvironment].EmailDomain}`,
    pkpass,
  );
  if (runEnvironment === "dev" && email === "testinguser@illinois.edu") {
    return;
  }
  const sesClient = new SESClient(commonConfig);
  return await sesClient.send(emailCommand);
};

export const pingHandler: SQSHandlerFunction<
  AvailableSQSFunctions.Ping
> = async (payload, metadata, logger) => {
  logger.error("Not implemented yet!");
  return;
};
