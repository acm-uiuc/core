import { test as base } from '@playwright/test';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

export const getSecretValue = async (
  secretId: string,
): Promise<Record<string, string | number | boolean> | null> => {
  const smClient = new SecretsManagerClient();
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
  let response = { PLAYWRIGHT_USERNAME: '', PLAYWRIGHT_PASSWORD: '' }
  let keyData;
  if (!process.env.PLAYWRIGHT_USERNAME || !process.env.PLAYWRIGHT_PASSWORD) {
    keyData = await getSecretValue('infra-core-api-config')
  }
  response['PLAYWRIGHT_USERNAME'] = process.env.PLAYWRIGHT_USERNAME || (keyData ? keyData['playwright_username'] : '');
  response['PLAYWRIGHT_PASSWORD'] = process.env.PLAYWRIGHT_PASSWORD || (keyData ? keyData['playwright_password'] : '');
  return response;
}

const secrets = await getSecrets();

async function becomeUser(page) {
  await page.goto('https://manage.qa.acmuiuc.org/login');
  await page.getByRole('button', { name: 'Sign in with Illinois NetID' }).click();
  await page.getByPlaceholder('NetID@illinois.edu').click();
  await page.getByPlaceholder('NetID@illinois.edu').fill(secrets['PLAYWRIGHT_USERNAME']);
  await page.getByPlaceholder('NetID@illinois.edu').press('Enter');
  await page.getByPlaceholder('Password').click();
  await page.getByPlaceholder('Password').fill(secrets['PLAYWRIGHT_PASSWORD']);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'No' }).click();
}

export const test = base.extend<{ becomeUser: (page) => Promise<void> }>({
  becomeUser: async ({ }, use) => {
    use(becomeUser)
  },
});
