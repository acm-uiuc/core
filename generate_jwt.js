import jwt from "jsonwebtoken";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";

export const getSecretValue = async (secretId) => {
  const smClient = new SecretsManagerClient();
  const data = await smClient.send(
    new GetSecretValueCommand({ SecretId: secretId }),
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

const secrets = await getSecretValue("infra-core-api-testing-credentials");
const client = new STSClient({ region: "us-east-2" });
const command = new GetCallerIdentityCommand({});
let data;
try {
  data = await client.send(command);
} catch {
  console.error(
    `Could not get AWS STS credentials: are you logged in to AWS? Run "aws configure sso" to log in.`,
  );
  process.exit(1);
}

const username = process.env.JWTGEN_USERNAME || data.UserId?.split(":")[1];
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
  groups: ["0"],
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

const token = jwt.sign(payload, secrets["jwt_key"], {
  algorithm: "HS256",
});
console.log(`USERNAME=${username}`);
console.log("=====================");
console.log(token);
