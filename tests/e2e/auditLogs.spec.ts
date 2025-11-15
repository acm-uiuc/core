import { expect } from "@playwright/test";
import { test } from "./base.js";
import { describe } from "node:test";

describe("Audit Log tests", () => {
  test("A user can view audit logs with filters", async ({
    page,
    becomeUser,
  }) => {
    await becomeUser(page);
    await page.locator("a").filter({ hasText: "Audit Logs" }).click();
    await page.getByRole("textbox", { name: "Module" }).click();
    await page.getByRole("option", { name: "Audit Log" }).click();
    await page.getByRole("button", { name: "Fetch Logs" }).click();
    await expect(page.getByRole("cell", { name: "Timestamp" })).toBeVisible();
    await page.getByRole("cell", { name: "Actor" }).click();
    await expect(page.getByRole("cell", { name: "Actor" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Action" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Target" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Request ID" })).toBeVisible();
    await page.getByRole("button", { name: "Fetch Logs" }).click();
    await page.getByRole("button", { name: "Fetch Logs" }).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Fetch Logs" }).click();

    await expect(page.locator("tbody")).toContainText(
      "core-e2e-testing@illinois.edu",
    );
    await expect(page.locator("tbody")).toContainText("Audit Log");
    await expect(page.locator("tbody")).toContainText("Viewed audit log from");
  });
});
