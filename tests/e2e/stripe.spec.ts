import { expect } from "@playwright/test";
import { test } from "./base";
import { describe } from "node:test";

describe("Stripe Link Creation Tests", () => {
  test("A user can see the link creation screen", async ({
    page,
    becomeUser,
  }) => {
    await becomeUser(page);
    await expect(
      page.locator("a").filter({ hasText: "Management Portal DEV ENV" }),
    ).toBeVisible();
    await expect(
      page.locator("a").filter({ hasText: "Stripe Link Creator" }),
    ).toBeVisible();
    await page.locator("a").filter({ hasText: "Stripe Link Creator" }).click();
    await expect(
      page.getByRole("textbox", { name: "Invoice Recipient Email" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Stripe Link Creator" }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Invoice ID" }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Invoice Amount" }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Invoice Recipient Name" }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Invoice Recipient Email" }),
    ).toBeVisible();
  });
});
