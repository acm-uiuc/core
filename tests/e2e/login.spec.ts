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
      page.getByRole("link", { name: "P", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "P", exact: true }).click();
    await expect(page.getByLabel("PMy Account")).toContainText(
      "Name Playwright Core User",
    );
    await expect(page.getByLabel("PMy Account")).toContainText(
      "Emailcore-e2e-testing@acm.illinois.edu",
    );
    expect(page.url()).toEqual("https://manage.qa.acmuiuc.org/home");
  });
});
