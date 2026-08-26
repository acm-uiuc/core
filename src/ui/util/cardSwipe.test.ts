import { describe, expect, it } from "vitest";
import { parseICardSwipe } from "./cardSwipe";

describe("parseICardSwipe", () => {
  it("extracts the UIN and ignores the final four digits before the caret", () => {
    const swipe =
      "%B6397%B6397123456789999^CARDHOLDER/UNIVERSITY^2908120?;6397123456789999=29081207767?";

    expect(parseICardSwipe(swipe)).toBe("123456789");
  });

  it.each([
    "%B639712345678999^CARDHOLDER/UNIVERSITY^",
    "%B6397%B63971234567899^CARDHOLDER/UNIVERSITY^",
    "%B6397%B6397123456789999CARDHOLDER/UNIVERSITY^",
  ])("rejects malformed swipe data: %s", (swipe) => {
    expect(parseICardSwipe(swipe)).toBeNull();
  });
});
