import { expect } from "@playwright/test";
import { capitalizeFirstLetter, getUpcomingEvents, test } from "./base.js";
import { describe } from "node:test";

describe("Events tests", () => {
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
