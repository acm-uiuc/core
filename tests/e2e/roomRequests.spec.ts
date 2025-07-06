import { expect } from "@playwright/test";
import { test } from "./base.js";
import { describe } from "node:test";

describe("Room Requests Tests", () => {
  test("A user can see the room requests screen", async ({
    page,
    becomeUser,
  }) => {
    await becomeUser(page);
    await expect(
      page.locator("a").filter({ hasText: "Management Portal DEV ENV" }),
    ).toBeVisible();
    await expect(
      page.locator("a").filter({ hasText: "Room Requests" }),
    ).toBeVisible();
    await page.locator("a").filter({ hasText: "Room Requests" }).click();
    await expect(page.getByRole("heading")).toContainText("Room Requests");
    await page.locator("button").filter({ hasText: "New Request" }).click();
    await expect(page.getByText("Basic Information")).toBeVisible();
    await expect(page.getByText("Compliance Information")).toBeVisible();
    await expect(page.getByText("Room Requirements")).toBeVisible();
    await expect(page.getByText("Miscellaneous Information")).toBeVisible();
    await page
      .locator("button")
      .filter({ hasText: "Existing Requests" })
      .click();
    await expect(page.locator(".mantine-Loader-root")).toHaveCount(0);
  });
});
