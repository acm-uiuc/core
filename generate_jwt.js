import jwt from "jsonwebtoken";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { randomUUID } from "crypto";

export const getSsmParameter = async (parameterName) => {
  const client = new SSMClient({
    region: process.env.AWS_REGION ?? "us-east-2",
  });

  const params = {
    Name: parameterName,
    WithDecryption: true,
  };

  const command = new GetParameterCommand(params);

  try {
    const data = await client.send(command);
    if (!data.Parameter || !data.Parameter.Value) {
      console.error(`Parameter ${parameterName} not found`);
      return null;
    }
    return data.Parameter.Value;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `Error retrieving parameter ${parameterName}: ${errorMessage}`,
      error,
    );
    return null;
  }
};

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

const key = await getSsmParameter("/infra-core-api/jwt_key");

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
  uti: randomUUID(),
  ver: "1.0",
};

const token = jwt.sign(payload, key, {
  algorithm: "HS256",
});
console.log(`USERNAME=${username}`);
console.log("=====================");
console.log(token);
