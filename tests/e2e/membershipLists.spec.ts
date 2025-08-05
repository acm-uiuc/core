import { expect } from "@playwright/test";
import { test } from "./base.js";
import { describe } from "node:test";
import { randomUUID } from "crypto";

describe("Internal Membership tests", () => {
  test("A user can query internal membership", async ({ page, becomeUser }) => {
    const uuid = `e2e-${randomUUID()}`;
    await becomeUser(page);
    await page.locator("a").filter({ hasText: "Membership Lists" }).click();
    await page
      .getByRole("textbox", { name: "NetID", exact: true })
      .fill("dsingh14");
    await page
      .getByRole("button", { name: "Query Membership", exact: true })
      .click();
    await expect(page.getByText("dsingh14 is a paid member.")).toBeVisible();
    await page.getByRole("textbox", { name: "NetID", exact: true }).fill("z");
    await page
      .getByRole("button", { name: "Query Membership", exact: true })
      .click();
    await expect(page.getByText("z is not a paid member.")).toBeVisible();
    await page
      .getByRole("textbox", { name: "NetID", exact: true })
      .fill("rjjones");
    await page
      .getByRole("button", { name: "Query Membership", exact: true })
      .click();
    await expect(page.getByText("rjjones is not a paid member.")).toBeVisible();
  });
});

describe("External Membership tests", () => {
  test("A user can create, modify, and delete external memberships", async ({
    page,
    becomeUser,
  }) => {
    const uuid = `e2e-${randomUUID()}`;
    await becomeUser(page);
    await page.locator("a").filter({ hasText: "Membership Lists" }).click();
    await page.getByRole("button", { name: "New List" }).click();
    await page.getByRole("textbox", { name: "New List ID" }).fill(uuid);
    await page.getByRole("textbox", { name: "Initial Member NetID" }).click();
    await page
      .getByRole("textbox", { name: "Initial Member NetID" })
      .fill("corete5");
    await page.getByRole("button", { name: "Create List" }).click();
    await expect(page.getByText("corete5")).toBeVisible();
    await expect(page.locator("tbody")).toContainText("corete5");
    await expect(page.locator("tbody")).toContainText("Active");
    await expect(page.getByText("Found 1 member.")).toBeVisible();
    await page.getByRole("button", { name: "Replace List" }).click();
    await page
      .getByRole("textbox", { name: "jdoe2 asmith3@illinois.edu" })
      .fill("corete5\ncorete6");
    await page.getByRole("button", { name: "Compute Changes" }).click();
    await expect(page.locator("tbody")).toContainText("corete6");
    await expect(page.locator("tbody")).toContainText("Queued for addition");
    await expect(page.locator("tbody")).toContainText("Cancel Add");
    await page
      .getByRole("button", { name: "Save Changes (1 Additions, 0" })
      .click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("main").nth(1)).toContainText(
      "Save Changes (1 Additions, 0 Removals)",
    );
    await page
      .getByRole("button", { name: "Save Changes (1 Additions, 0" })
      .click();
    await page.getByRole("button", { name: "Confirm and Save" }).click();
    await page
      .getByRole("row", { name: "CO corete5 Active Remove" })
      .getByRole("button")
      .click();
    await page.getByRole("button", { name: "Remove" }).click();
    await page
      .getByRole("button", { name: "Save Changes (0 Additions, 2" })
      .click();
    await page.getByRole("button", { name: "Confirm and Save" }).click();
    await expect(page.getByText("Member list has been updated.")).toBeVisible();
    // Part 2
    await page.reload();
    await expect(
      page.getByText("Manage External Membership Lists"),
    ).toBeVisible();
    await page.getByPlaceholder("Pick a list to manage").click();
    await expect(page.getByText(uuid)).not.toBeVisible();
    await expect(page.getByText("acmlivetesting")).toBeVisible();
  });
});
