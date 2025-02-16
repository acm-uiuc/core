import { expect, test, describe } from "vitest";
import { transformCommaSeperatedName } from "../../../src/common/utils.js";

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
