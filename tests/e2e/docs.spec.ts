import { expect } from "@playwright/test";
import { capitalizeFirstLetter, getUpcomingEvents, test } from "./base.js";
import { describe } from "node:test";

describe("Docs tests", () => {
  test("A user can view the API documentation", async ({ page }) => {
    await page.goto(
      process.env.E2E_TEST_HOST || "https://core.aws.qa.acmuiuc.org/docs",
    );
    expect(
      page.getByRole("heading", { name: "ACM @ UIUC Core API" }),
    ).toBeDefined();
    expect(page.getByRole("heading", { name: "Usage" })).toBeDefined();
    expect(page.getByRole("heading", { name: "Contact" })).toBeDefined();
    expect(
      page.getByRole("heading", {
        name: "Retrieve calendar events with applied filters.",
      }),
    ).toBeDefined();
  });
  test("A user can make API requests using the API documentation site", async ({
    page,
  }) => {
    await page.goto(
      process.env.E2E_TEST_HOST || "https://core.aws.qa.acmuiuc.org/docs",
    );
    expect(
      page.getByRole("heading", { name: "ACM @ UIUC Core API" }),
    ).toBeDefined();
    await page
      .getByRole("link", { name: "Retrieve calendar events with" })
      .click();
    await page
      .getByRole("button", { name: "Test Request (get /api/v1/events)" })
      .click();
    await page
      .getByRole("button", { name: "Send get request to https://" })
      .click();
    await expect(page.getByLabel("Response", { exact: true })).toContainText(
      "200 OK",
    );
  });
});
