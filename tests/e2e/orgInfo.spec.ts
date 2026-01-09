import { expect } from "@playwright/test";
import { RecursiveRecord, test } from "./base.js";
import { describe } from "node:test";

describe("Organization Info Tests", () => {
  test("A user can update org metadata", async ({ page, becomeUser }) => {
    const date = new Date().toISOString();
    await becomeUser(page);
    await expect(
      page.locator("a").filter({ hasText: "Management Portal DEV ENV" }),
    ).toBeVisible();
    await expect(
      page.locator("a").filter({ hasText: "Organization Info" }),
    ).toBeVisible();
    await page.locator("a").filter({ hasText: "Organization Info" }).click();
    await expect(page.getByRole("heading")).toContainText(
      "Manage Organization Info",
    );
    await page.getByRole("textbox", { name: "Select an organization" }).click();
    await page.getByText("Infrastructure Committee").click();
    await page.getByRole("textbox", { name: "Description" }).click();
    await page
      .getByRole("textbox", { name: "Description" })
      .fill(`Populated by E2E tests on ${date}`);
    await page
      .getByRole("textbox", { name: "Website" })
      .fill(`https://infra.acm.illinois.edu?date=${date}`);

    const existingOtherLink = page.locator("text=Other").first();
    const hasExistingOther = await existingOtherLink
      .isVisible()
      .catch(() => false);

    if (!hasExistingOther) {
      await page.getByRole("button", { name: "Add Link" }).click();
      await page.getByRole("textbox", { name: "Type" }).click();
      await page.getByRole("option", { name: "Other" }).click();
    }

    await page.getByRole("textbox", { name: "URL" }).click();
    await page
      .getByRole("textbox", { name: "URL" })
      .fill(`https://infra.acm.illinois.edu/e2e?date=${date}`);
    await page
      .locator("form")
      .getByRole("button", { name: "Save Changes" })
      .click();
    await expect(
      page.getByText("Infrastructure Committee updated"),
    ).toBeVisible();

    const data = await fetch(
      `https://core.aws.qa.acmuiuc.org/api/v1/organizations?date=${date}`,
    );
    const json = (await data.json()) as RecursiveRecord[];
    const infraEntry = json.find((x) => x.id === "C01");

    expect(infraEntry).toBeDefined();
    expect(infraEntry?.description).toBe(`Populated by E2E tests on ${date}`);
    expect(infraEntry?.website).toBe(
      `https://infra.acm.illinois.edu?date=${date}`,
    );

    const links = infraEntry?.links as RecursiveRecord[];
    expect(links).toBeDefined();
    const otherLink = links.find((link) => link.type === "OTHER");
    expect(otherLink).toBeDefined();
    expect(otherLink?.url).toBe(
      `https://infra.acm.illinois.edu/e2e?date=${date}`,
    );
  });
});
