import { AssumeRoleCommand } from "@aws-sdk/client-sts";
import { STSClient } from "@aws-sdk/client-sts";
import { genericConfig } from "common/config.js";
import { InternalServerError } from "common/errors/index.js";

export async function getRoleCredentials(
  roleArn: string,
  durationSeconds: number = 900,
) {
  const client = new STSClient({ region: genericConfig.AwsRegion });
  const command = new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: `core-api-${process.env.RunEnvironment || "dev"}`,
    DurationSeconds: durationSeconds,
  });
  const creds = (await client.send(command)).Credentials;
  if (
    !creds ||
    !creds.AccessKeyId ||
    !creds.SecretAccessKey ||
    !creds.SessionToken
  ) {
    throw new InternalServerError({
      message: "Could not assume Entra ID role",
    });
  }
  return {
    accessKeyId: creds.AccessKeyId,
    secretAccessKey: creds.SecretAccessKey,
    sessionToken: creds.SessionToken,
    expiration: creds.Expiration,
  };
}
