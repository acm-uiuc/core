import { expect } from "@playwright/test";
import { test } from "./base.js";
test.describe.serial("Event lifecycle test", () => {
  const testId = `Events-E2E-${Date.now()}`;
  test("A user can create an event", async ({ page, becomeUser }) => {
    await becomeUser(page);
    await page.locator("a").filter({ hasText: "Events" }).click();
    await page.getByRole("button", { name: "Create Event" }).click();
    await page.getByRole("tab", { name: "From Scratch" }).click();
    await page.getByRole("textbox", { name: "Event Title" }).click();
    await page.getByRole("textbox", { name: "Event Title" }).fill(testId);
    await page.getByRole("textbox", { name: "Event Description" }).click();
    await page
      .getByRole("textbox", { name: "Event Description" })
      .fill("E2E Testing Event");
    await page.getByRole("button", { name: "Start Date & Time" }).click();
    await page.getByRole("spinbutton", { name: "--" }).nth(0).click();
    await page.getByRole("spinbutton", { name: "--" }).nth(0).fill("023");
    await page.getByRole("spinbutton", { name: "--" }).nth(1).click();
    await page.getByRole("spinbutton", { name: "--" }).nth(1).fill("030");
    await page.getByRole("button").filter({ hasText: /^$/ }).nth(2).click();
    await page.getByRole("button", { name: "End Date & Time" }).click();
    await page.getByRole("spinbutton", { name: "--" }).first().click();
    await page.getByRole("spinbutton", { name: "--" }).first().fill("023");
    await page.getByRole("spinbutton", { name: "--" }).nth(1).fill("059");
    await page.getByRole("button").filter({ hasText: /^$/ }).nth(2).click();
    await page.getByRole("textbox", { name: "Event Location" }).dblclick();
    await page
      .getByRole("textbox", { name: "Event Location" })
      .fill("ACM Room");
    await page.getByRole("textbox", { name: "Host" }).click();
    await page.getByRole("textbox", { name: "Host" }).fill("Infrastructure");
    await page.getByText("Infrastructure Committee").click();
    await page.getByRole("textbox", { name: "Paid Event ID" }).click();
    await page.getByRole("textbox", { name: "Paid Event ID" }).fill("abcd123");
    await page.getByRole("button", { name: "Add Field" }).click();
    await page.getByRole("textbox", { name: "Key" }).click();
    await page.getByRole("textbox", { name: "Key" }).fill("form1");
    await page.getByRole("textbox", { name: "Value" }).click();
    await page.getByRole("textbox", { name: "Value" }).fill("value1");
    await page.getByRole("button", { name: "Add Field" }).click();
    await page.getByRole("textbox", { name: "Key" }).nth(1).fill("form2");
    await page.getByRole("textbox", { name: "Value" }).nth(1).click();
    await page.getByRole("textbox", { name: "Value" }).nth(1).fill("value2");
    await page.getByRole("button", { name: "Create Event" }).click();
  });
  test("A user can delete an event", async ({ page, becomeUser }) => {
    await becomeUser(page);
    await page.locator("a").filter({ hasText: "Events" }).click();
    const table = page.getByTestId("events-table");
    await expect(table).toBeVisible();
    const row = table.locator(`tbody tr:has-text("${testId}")`);
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Delete" }).click();
    await expect(
      page.locator(':text("Are you sure you want to delete the event")'),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(
      page.locator(':text("The event was successfully deleted.")'),
    ).toBeVisible();
  });
});
