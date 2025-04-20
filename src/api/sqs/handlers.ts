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
import {
  environmentConfig,
  genericConfig,
  roleArns,
} from "../../common/config.js";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { issueAppleWalletMembershipCard } from "../../api/functions/mobileWallet.js";
import { generateMembershipEmailCommand } from "../../api/functions/ses.js";
import { SESClient } from "@aws-sdk/client-ses";
import pino from "pino";
import { getRoleCredentials } from "api/functions/sts.js";
import { setPaidMembership } from "api/functions/membership.js";
import { createAuditLogEntry } from "api/functions/auditLog.js";

const getAuthorizedClients = async (
  logger: pino.Logger,
  commonConfig: { region: string },
) => {
  if (roleArns.Entra) {
    logger.info(
      `Attempting to assume Entra role ${roleArns.Entra} to get the Entra token...`,
    );
    const credentials = await getRoleCredentials(roleArns.Entra);
    const clients = {
      smClient: new SecretsManagerClient({
        region: genericConfig.AwsRegion,
        credentials,
      }),
      dynamoClient: new DynamoDBClient({
        region: genericConfig.AwsRegion,
        credentials,
      }),
    };
    logger.info(`Assumed Entra role ${roleArns.Entra} to get the Entra token.`);
    return clients;
  } else {
    logger.debug("Did not assume Entra role as no env variable was present");
    return {
      smClient: new SecretsManagerClient(commonConfig),
      dynamoClient: new DynamoDBClient(commonConfig),
    };
  }
};

export const emailMembershipPassHandler: SQSHandlerFunction<
  AvailableSQSFunctions.EmailMembershipPass
> = async (payload, metadata, logger) => {
  const email = payload.email;
  const commonConfig = { region: genericConfig.AwsRegion };
  const clients = await getAuthorizedClients(logger, commonConfig);
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
    metadata.initiator,
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
> = async (_payload, _metadata, logger) => {
  logger.info("Pong!");
};

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
        module: "provisionNewMember",
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
