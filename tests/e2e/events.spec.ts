import { expect } from "@playwright/test";
import { capitalizeFirstLetter, getUpcomingEvents, test } from "./base";
import { describe } from "node:test";

describe("Events tests", () => {
  test("A user can login and view the upcoming events", async ({
    page,
    becomeUser,
  }) => {
    await becomeUser(page);
    await page.locator('a').filter({ hasText: 'Events' }).click();
    await expect(page.getByRole('heading')).toContainText('Core Management Service (NonProd)');
    await expect(page.getByRole('button', { name: 'New Calendar Event' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show Previous Events' })).toBeVisible();

    const table = page.getByTestId('events-table');
    await expect(table).toBeVisible();

    const rows = await table.locator('tbody tr').all();
    const expectedTableData = await getUpcomingEvents();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const expectedData = expectedTableData[i];

      const title = await row.locator('td:nth-child(1)').innerText();
      const location = await row.locator('td:nth-child(4)').innerText();
      const description = await row.locator('td:nth-child(5)').innerText();
      const host = await row.locator('td:nth-child(6)').innerText();
      const featured = await row.locator('td:nth-child(7)').innerText();
      const repeats = await row.locator('td:nth-child(8)').innerText();

      expect(title).toEqual(expectedData.title);
      expect(location).toEqual(expectedData.location);
      expect(description).toEqual(expectedData.description);
      expect(host).toEqual(expectedData.host);
      expect(featured).toEqual(expectedData.featured ? "Yes" : "No");
      expect(repeats).toEqual(capitalizeFirstLetter(expectedData.repeats));
    }

    expect(page.url()).toEqual("https://manage.qa.acmuiuc.org/events/manage");
  });
});
