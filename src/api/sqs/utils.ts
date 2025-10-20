import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { getRoleCredentials } from "api/functions/sts.js";
import { genericConfig, roleArns, SecretConfig } from "common/config.js";
import pino from "pino";
import { currentEnvironmentConfig } from "./index.js";
import { getSecretValue } from "api/plugins/auth.js";

export const getAuthorizedClients = async (
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
        region: genericConfig.AwsOhioRegion,
        credentials,
      }),
      dynamoClient: new DynamoDBClient({
        region: genericConfig.AwsOhioRegion,
        credentials,
      }),
    };
    logger.info(`Assumed Entra role ${roleArns.Entra} to get the Entra token.`);
    return clients;
  }
  logger.debug("Did not assume Entra role as no env variable was present");
  return {
    smClient: new SecretsManagerClient(commonConfig),
    dynamoClient: new DynamoDBClient(commonConfig),
  };
};

export const getSecretConfig = async ({
  logger,
  commonConfig: { region },
}: {
  logger: pino.Logger;
  commonConfig: { region: string };
}) => {
  const smClient = new SecretsManagerClient({ region });
  logger.debug(
    `Getting secrets: ${JSON.stringify(currentEnvironmentConfig.ConfigurationSecretIds)}.`,
  );
  const allSecrets = await Promise.all(
    currentEnvironmentConfig.ConfigurationSecretIds.map((secretName) =>
      getSecretValue(smClient, secretName),
    ),
  );
  const secretConfig = allSecrets.reduce(
    (acc, currentSecret) => ({ ...acc, ...currentSecret }),
    {},
  ) as SecretConfig;
  return secretConfig;
};
