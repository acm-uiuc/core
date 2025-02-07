import jwt from "jsonwebtoken";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

export const getSecretValue = async (
  secretId: string,
): Promise<Record<string, string | number | boolean> | null> => {
  const smClient = new SecretsManagerClient({
    region: process.env.AWS_REGION || "us-east-1",
  });
  const data = await smClient.send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  if (!data.SecretString) {
    return null;
  }
  try {
    return JSON.parse(data.SecretString) as Record<
      string,
      string | number | boolean
    >;
  } catch {
    return null;
  }
};

async function getSecrets() {
  const response = { JWTKEY: "" };
  let keyData;
  if (!process.env.JWT_KEY) {
    keyData = await getSecretValue("infra-core-api-config");
  }
  response["JWTKEY"] =
    process.env.JWT_KEY || (keyData ? keyData["jwt_key"] : "");
  return response;
}

export async function createJwt(
  username: string = "infra@acm.illinois.edu",
  groups: string[] = ["0"],
) {
  const secretData = await getSecrets();
  const payload = {
    aud: "custom_jwt",
    iss: "custom_jwt",
    iat: Math.floor(Date.now() / 1000),
    nbf: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600 * 24, // Token expires after 24 hour
    acr: "1",
    aio: "AXQAi/8TAAAA",
    amr: ["pwd"],
    appid: "your-app-id",
    appidacr: "1",
    email: username,
    groups,
    idp: "https://login.microsoftonline.com",
    ipaddr: "192.168.1.1",
    name: "Doe, John",
    oid: "00000000-0000-0000-0000-000000000000",
    rh: "rh-value",
    scp: "user_impersonation",
    sub: "subject",
    tid: "tenant-id",
    unique_name: username,
    uti: "uti-value",
    ver: "1.0",
  };
  const token = jwt.sign(payload, secretData.JWTKEY, { algorithm: "HS256" });
  return token;
}
