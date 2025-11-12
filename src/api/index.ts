import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { genericConfig } from "common/config.js";
import init from "./server.js";

console.log(`Logging level set to ${process.env.LOG_LEVEL || "info"}`);
const client = new STSClient({ region: genericConfig.AwsRegion });
const command = new GetCallerIdentityCommand({});
try {
  const data = await client.send(command);
  console.log(`Logged in to AWS as ${data.Arn} on account ${data.Account}.`);
} catch {
  console.error(
    `Could not get AWS STS credentials: are you logged in to AWS? Run "aws configure sso" to log in.`,
  );
  process.exit(1);
}
const app = await init(true);
app.listen({ port: 8080 }, (err) => {
  /* eslint no-console: ["error", {"allow": ["log", "error"]}] */
  if (err) {
    console.error(err);
  }
});