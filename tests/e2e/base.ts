import { test as base, Page } from "@playwright/test";
import { getSsmParameter } from "../common/index.js";

export interface RecursiveRecord extends Record<
  string,
  any | RecursiveRecord
> {}

async function getSecrets() {
  const data = await Promise.all([
    getSsmParameter("/infra-core-api/playwright_username"),
    getSsmParameter("/infra-core-api/playwright_password"),
  ]);
  if (!data[0] || !data[1]) {
    throw new Error("Failed to get login credentials.");
  }
  return { PLAYWRIGHT_USERNAME: data[0], PLAYWRIGHT_PASSWORD: data[1] };
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
  return (await data.json()) as RecursiveRecord[];
}

export async function getAllEvents() {
  const data = await fetch("https://core.aws.qa.acmuiuc.org/api/v1/events");
  return (await data.json()) as RecursiveRecord[];
}

export const test = base.extend<{ becomeUser: (page: Page) => Promise<void> }>({
  becomeUser: async ({}, use) => {
    use(becomeUser);
  },
});
