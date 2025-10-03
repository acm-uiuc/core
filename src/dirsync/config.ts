import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { z } from "zod";
import { logger } from "./logging";

export const CONFIG_SECRET = "infra-core-api-gsuite-dirsync-config";

const SecretsConfigSchema = z.object({
  entraTenantId: z.string().min(1, "entraTenantId is required"),
  entraClientId: z.string().min(1, "entraClientId is required"),
  entraClientCertificate: z
    .string()
    .min(1, "entraClientCertificate is required"),
  // googleDelegatedUser: z
  //   .string()
  //   .email("googleDelegatedUser must be a valid email"),
  // googleServiceAccountJson: z
  //   .string()
  //   .min(1, "googleServiceAccountJson is required"),
  deleteRemovedContacts: z.boolean().default(false),
});

const EnvironmentSchema = z.enum(["dev", "prod"]);

export type SecretsConfig = z.infer<typeof SecretsConfigSchema>;
export type Environment = z.infer<typeof EnvironmentSchema>;

export interface Config extends SecretsConfig {
  environment: Environment;
}

export const getSecrets = async (): Promise<unknown> => {
  const smClient = new SecretsManagerClient();
  const data = await smClient.send(
    new GetSecretValueCommand({ SecretId: CONFIG_SECRET }),
  );
  if (!data.SecretString) {
    return null;
  }
  try {
    return JSON.parse(data.SecretString);
  } catch {
    return null;
  }
};

export const getConfig = async (): Promise<Config> => {
  const secrets = await getSecrets();

  if (!secrets) {
    throw new Error(
      `Failed to load configuration from secret: ${CONFIG_SECRET}`,
    );
  }
  const parsedSecrets = SecretsConfigSchema.parse(secrets);

  const environment = EnvironmentSchema.parse(process.env.RunEnvironment);

  const config: Config = {
    ...parsedSecrets,
    environment,
  };

  logger.info(
    `Configuration loaded successfully for "${config.environment}" environment`,
  );

  return config;
};
