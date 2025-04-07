import { expect } from "@playwright/test";
import { test } from "./base";
import { describe } from "node:test";

describe("Login tests", () => {
  test("A user can login and view the home screen", async ({
    page,
    becomeUser,
  }) => {
    await becomeUser(page);
    await expect(
      page.locator("a").filter({ hasText: "Management Portal DEV ENV" }),
    ).toBeVisible();
    await expect(page.locator("a").filter({ hasText: "Events" })).toBeVisible();
    await expect(
      page.locator("a").filter({ hasText: "Ticketing/Merch" }),
    ).toBeVisible();
    await expect(page.locator("a").filter({ hasText: "IAM" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "ACM Logo Management Portal" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "PU", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "PU", exact: true }).click();
    await expect(page.getByLabel("PUMy Account")).toContainText(
      "NamePlaywright UserEmailcore-e2e-testing@acm.illinois.eduEdit ProfileLog Out",
    );
    expect(page.url()).toEqual("https://core.aws.qa.acmuiuc.org/home");
  });
});
