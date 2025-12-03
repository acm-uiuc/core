import { expect } from "@playwright/test";
import { capitalizeFirstLetter, getUpcomingEvents, test } from "./base.js";
import { describe } from "node:test";

describe("Events page load test", () => {
  test("A user can login and view the upcoming events", async ({
    page,
    becomeUser,
  }) => {
    await becomeUser(page);
    await page.locator("a").filter({ hasText: "Events" }).click();
    await expect(page.getByRole("heading")).toContainText("Event Management");
    await expect(
      page.getByRole("button", { name: "Create Event" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Show Previous Events" }),
    ).toBeVisible();

    const table = page.getByTestId("events-table");
    await expect(table).toBeVisible();

    const rows = await table.locator("tbody tr").all();
    const expectedTableData = await getUpcomingEvents();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const expectedData = expectedTableData[i];

      const title = (await row.locator("td:nth-child(1)").innerText()).trim();
      const location = (
        await row.locator("td:nth-child(4)").innerText()
      ).trim();
      const host = (await row.locator("td:nth-child(5)").innerText()).trim();
      const repeats = (await row.locator("td:nth-child(6)").innerText()).trim();

      let expectedTitle = expectedData.title;
      if (expectedData.featured) {
        expectedTitle = `${expectedData.title} \nFEATURED`;
      }

      expect(title.trim()).toEqual(expectedTitle.trim());
      expect(location).toEqual(expectedData.location.trim());
      expect(host).toEqual(expectedData.host.trim());
      expect(repeats).toEqual(
        capitalizeFirstLetter(expectedData.repeats).trim(),
      );
    }

    expect(page.url()).toEqual("https://core.aws.qa.acmuiuc.org/events/manage");
  });
});

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
