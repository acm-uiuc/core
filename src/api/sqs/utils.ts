import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { getRoleCredentials } from "api/functions/sts.js";
import { genericConfig, roleArns } from "common/config.js";
import pino from "pino";

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
  }
  logger.debug("Did not assume Entra role as no env variable was present");
  return {
    smClient: new SecretsManagerClient(commonConfig),
    dynamoClient: new DynamoDBClient(commonConfig),
  };
};
