import { test as base, Page } from "@playwright/test";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

export const getSecretValue = async (
  secretId: string,
): Promise<Record<string, string | number | boolean> | null> => {
  const smClient = new SecretsManagerClient({
    region: process.env.AWS_REGION ?? "us-east-2",
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
  let response = { PLAYWRIGHT_USERNAME: "", PLAYWRIGHT_PASSWORD: "" };
  let keyData;
  if (!process.env.PLAYWRIGHT_USERNAME || !process.env.PLAYWRIGHT_PASSWORD) {
    keyData = await getSecretValue("infra-core-api-testing-credentials");
  }
  response["PLAYWRIGHT_USERNAME"] =
    process.env.PLAYWRIGHT_USERNAME ||
    ((keyData ? keyData["playwright_username"] : "") as string);
  response["PLAYWRIGHT_PASSWORD"] =
    process.env.PLAYWRIGHT_PASSWORD ||
    ((keyData ? keyData["playwright_password"] : "") as string);
  return response;
}

const secrets = await getSecrets();

export function capitalizeFirstLetter(string: string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

async function becomeUser(page: Page) {
  await page.goto(
    process.env.E2E_TEST_HOST || "https://core.aws.qa.acmuiuc.org/login",
  );
  await page
    .getByRole("button", { name: "Sign in with Illinois NetID" })
    .click();
  await page.getByPlaceholder("NetID@illinois.edu").click();
  await page
    .getByPlaceholder("NetID@illinois.edu")
    .fill(secrets["PLAYWRIGHT_USERNAME"]);
  await page.getByPlaceholder("NetID@illinois.edu").press("Enter");
  await page.getByPlaceholder("Password").click();
  await page.getByPlaceholder("Password").evaluate((input, password) => {
    (input as any).value = password;
  }, secrets["PLAYWRIGHT_PASSWORD"]);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "No" }).click();
}

export async function getUpcomingEvents() {
  const data = await fetch(
    "https://core.aws.qa.acmuiuc.org/api/v1/events?upcomingOnly=true",
  );
  return (await data.json()) as Record<string, string>[];
}

export async function getAllEvents() {
  const data = await fetch("https://core.aws.qa.acmuiuc.org/api/v1/events");
  return (await data.json()) as Record<string, string>[];
}

export const test = base.extend<{ becomeUser: (page: Page) => Promise<void> }>({
  becomeUser: async ({}, use) => {
    use(becomeUser);
  },
});
