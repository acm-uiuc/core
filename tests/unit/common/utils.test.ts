import { expect, test, describe } from "vitest";
import { transformCommaSeperatedName, transformSigLeadToURI } from "../../../src/common/utils.js";

describe("Comma-seperated name transformer tests", () => {
  test("Already-transformed names are returned as-is", () => {
    const output = transformCommaSeperatedName("Test User");
    expect(output).toEqual("Test User");
  });
  test("Last, First is returned as First Last", () => {
    const output = transformCommaSeperatedName("User, Test");
    expect(output).toEqual("Test User");
  });
  test("Last, First Middle is returned as First Last", () => {
    const output = transformCommaSeperatedName("User, Test Thing");
    expect(output).toEqual("Test User");
  });
  test("`Last, ` is returned as-is", () => {
    const output = transformCommaSeperatedName("User, ");
    expect(output).toEqual("User, ");
  });
  test("`Last,` is returned as-is", () => {
    const output = transformCommaSeperatedName("User,");
    expect(output).toEqual("User,");
  });
  test("`, Test` is returned as-is", () => {
    const output = transformCommaSeperatedName(", Test");
    expect(output).toEqual(", Test");
  });
});

describe("transformSigLeadToURI tests", () => {

  // Basic Functionality Tests
  test("should convert simple names with spaces to lowercase hyphenated", () => {
    const output = transformSigLeadToURI("SIG Network");
    expect(output).toEqual("sig-network");
  });

  test("should convert simple names to lowercase", () => {
    const output = transformSigLeadToURI("Testing");
    expect(output).toEqual("testing");
  });

  test("should handle names already in the desired format", () => {
    const output = transformSigLeadToURI("already-transformed-name");
    expect(output).toEqual("already-transformed-name");
  });

  // Camel Case Tests
  test("should add hyphens between camelCase words", () => {
    const output = transformSigLeadToURI("SIGAuth");
    expect(output).toEqual("sig-auth");
  });

  test("should handle multiple camelCase words", () => {
    const output = transformSigLeadToURI("SuperCamelCaseProject");
    expect(output).toEqual("super-camel-case-project");
  });

  test("should handle mixed camelCase and spaces", () => {
    const output = transformSigLeadToURI("SIG ContribEx"); // SIG Contributor Experience
    expect(output).toEqual("sig-contrib-ex");
  });

  test("should handle camelCase starting with lowercase", () => {
    const output = transformSigLeadToURI("myCamelCaseName");
    expect(output).toEqual("my-camel-case-name");
  });

  // Reserved Character Tests (RFC 3986 gen-delims and sub-delims)
  test("should convert reserved characters like & to hyphens", () => {
    const output = transformSigLeadToURI("SIG Storage & Backup");
    expect(output).toEqual("sig-storage-backup"); // & -> space -> hyphen
  });

  test("should convert reserved characters like / and : to hyphens", () => {
    const output = transformSigLeadToURI("Project:Alpha/Beta");
    expect(output).toEqual("project-alpha-beta"); // : -> space, / -> space, space+space -> hyphen
  });

  test("should convert reserved characters like () and + to hyphens", () => {
    const output = transformSigLeadToURI("My Project (Test+Alpha)");
    expect(output).toEqual("my-project-test-alpha");
  });

  test("should convert various reserved characters #[]@?$, to hyphens", () => {
    const output = transformSigLeadToURI("Special#Chars[Test]?@Value,$");
    expect(output).toEqual("special-chars-test-value");
  });

  // Non-Allowed Character Removal Tests
  test("should remove characters not unreserved or reserved (e.g., ™, ©)", () => {
    const output = transformSigLeadToURI("MyOrg™ With © Symbols");
    expect(output).toEqual("my-org-with-symbols");
  });

  test("should remove emoji", () => {
    const output = transformSigLeadToURI("Project ✨ Fun");
    expect(output).toEqual("project-fun");
  });


  // Whitespace and Hyphen Collapsing Tests
  test("should handle multiple spaces between words", () => {
    const output = transformSigLeadToURI("SIG   UI   Project");
    expect(output).toEqual("sig-ui-project");
  });

  test("should handle leading/trailing whitespace", () => {
    const output = transformSigLeadToURI("  Leading and Trailing  ");
    expect(output).toEqual("leading-and-trailing");
  });

  test("should handle mixed whitespace (tabs, newlines)", () => {
    const output = transformSigLeadToURI("Mix\tOf\nWhite Space");
    expect(output).toEqual("mix-of-white-space");
  });

  test("should collapse multiple hyphens resulting from transformations", () => {
    const output = transformSigLeadToURI("Test--Multiple / Spaces");
    expect(output).toEqual("test-multiple-spaces");
  });

  test("should collapse hyphens from start/end after transformations", () => {
    const output = transformSigLeadToURI("&Another Test!");
    expect(output).toEqual("another-test");
  });

  // Unreserved Character Tests (RFC 3986)
  test("should keep unreserved characters: hyphen, period, underscore, tilde", () => {
    const output = transformSigLeadToURI("Keep.These-Chars_Okay~123");
    expect(output).toEqual("keep.these-chars_okay~123");
  });

  test("should handle unreserved chars next to reserved chars", () => {
    const output = transformSigLeadToURI("Test._~&Stuff");
    expect(output).toEqual("test._~-stuff");
  });


  // Edge Case Tests
  test("should return an empty string for an empty input", () => {
    const output = transformSigLeadToURI("");
    expect(output).toEqual("");
  });

  test("should return an empty string for input with only spaces", () => {
    const output = transformSigLeadToURI("   ");
    expect(output).toEqual("");
  });

  test("should return an empty string for input with only reserved/non-allowed chars and spaces", () => {
    const output = transformSigLeadToURI("  & / # ™ ©   ");
    expect(output).toEqual("");
  });

  test("should handle numbers correctly", () => {
    const output = transformSigLeadToURI("ProjectApollo11");
    expect(output).toEqual("project-apollo11"); // Number doesn't trigger camel case break after letter
  });

  test("should handle numbers triggering camel case break", () => {
    const output = transformSigLeadToURI("Project11Apollo");
    expect(output).toEqual("project-11-apollo"); // Letter after number triggers camel case break
  });

  test("should handle names starting with lowercase", () => {
    const output = transformSigLeadToURI("myOrg");
    expect(output).toEqual("my-org");
  });

});
