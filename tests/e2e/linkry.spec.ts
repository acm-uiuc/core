import { expect } from "@playwright/test";
import { test } from "./base.js";
import { describe } from "node:test";
import { randomUUID } from "crypto";

describe("Link Shortener tests", () => {
  test("A user can create shortened links, fetch them, and then delete them", async ({
    page,
    becomeUser,
    request, // Inject the request fixture
  }) => {
    test.slow();
    const uuid = `e2e-${randomUUID()}`;
    await becomeUser(page);
    await page.locator("a").filter({ hasText: "Link Shortener" }).click();
    await page.getByRole("button", { name: "Add New Link" }).click();
    await page.getByRole("button", { name: "Random" }).click();
    await page.getByRole("textbox", { name: "Short URL" }).fill(uuid);
    await page.getByRole("textbox", { name: "URL to shorten" }).click();
    await page
      .getByRole("textbox", { name: "URL to shorten" })
      .fill("https://google.com");
    await page
      .locator("div")
      .filter({
        hasText:
          /^Access DelegationSelect groups which are permitted to manage this link\.$/,
      })
      .locator("div")
      .nth(1)
      .click();
    await page.getByRole("option", { name: "ACM Infra Chairs" }).click();
    await page
      .locator("div")
      .filter({ hasText: /^ACM Infra Chairs$/ })
      .nth(1)
      .click();
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL("https://core.aws.qa.acmuiuc.org/linkry");

    const shortLinkBaseUrl = "go.aws.qa.acmuiuc.org/"; // Base URL for your shortened links
    const fullShortLink = `${shortLinkBaseUrl}${uuid}`;

    let responseStatus: number | undefined;
    let finalRedirectUrl: string | undefined;
    const maxRetries = 20;

    for (let i = 0; i < maxRetries; i++) {
      try {
        console.log(`Attempt ${i + 1} to fetch ${fullShortLink}`);
        const response = await request.get(`https://${fullShortLink}`, {
          failOnStatusCode: false, // Don't fail the test immediately on non-2xx/3xx status codes
          maxRedirects: 5, // Allow redirects
        });
        responseStatus = response.status();
        finalRedirectUrl = response.url();
        console.log(`Response status for ${fullShortLink}: ${responseStatus}`);
        console.log(`Final URL after redirect: ${finalRedirectUrl}`);

        if (responseStatus >= 200 && responseStatus < 400) {
          expect(finalRedirectUrl).toBe("https://www.google.com/");
          break;
        }
      } catch (error) {
        if (error instanceof Error) {
          console.warn(`Fetch failed on attempt ${i + 1}: ${error.message}`);
        }
      }

      if (i < maxRetries - 1) {
        const delay = Math.min(10000 * Math.pow(1.5, i), 30000);
        console.log(`Retrying in ${delay / 1000} seconds...`);
        await page.waitForTimeout(delay);
      }
    }

    expect(responseStatus).toBeGreaterThanOrEqual(200);
    expect(responseStatus).toBeLessThan(400);
    expect(finalRedirectUrl).toBe("https://www.google.com/");

    // Continue with the UI assertion and deletion
    await expect(page.getByLabel("My Links").locator("tbody")).toContainText(
      fullShortLink,
    );
    await page
      .getByRole("row", { name: fullShortLink })
      .getByRole("button")
      .click();
    await expect(
      page.getByLabel("Confirm Deletion").getByRole("paragraph"),
    ).toContainText(
      `Are you sure you want to delete the redirect from ${uuid} to https://google.com?`,
    );
    await page.getByRole("button", { name: "Delete" }).click();
  });
});
