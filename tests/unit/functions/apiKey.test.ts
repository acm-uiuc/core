import * as argon2 from "argon2";
import { expect, test, describe, vi } from "vitest";
import { createApiKey, verifyApiKey } from "../../../src/api/functions/apiKey.js";


const countOccurrencesOfChar = (s: string, char: string): number => {
  let count = 0;
  for (const item of s) {
    if (item == char) {
      count++;
    }
  }
  return count;
}

describe("Audit Log tests", () => {
  test("API key is successfully created and validated", async () => {
    const { apiKey, hashedKey, keyId } = await createApiKey();
    expect(apiKey.slice(0, 8)).toEqual("acmuiuc_");
    expect(keyId.length).toEqual(12);
    expect(countOccurrencesOfChar(apiKey, "_")).toEqual(3);
    const verificationResult = await verifyApiKey({ apiKey, hashedKey });
    expect(verificationResult).toBe(true);
  })
  test("API Keys that don't start with correct prefix are rejected", async () => {
    const { apiKey, hashedKey } = await createApiKey();
    const verificationResult = await verifyApiKey({ apiKey: apiKey.replace("acmuiuc_", "acm_"), hashedKey: hashedKey });
    expect(verificationResult).toBe(false);
  })
  test("API Keys that have an incorrect checksum are rejected", async () => {
    const { apiKey, hashedKey } = await createApiKey();
    const submittedChecksum = apiKey.split("_")[3];
    const verificationResult = await verifyApiKey({ apiKey: apiKey.replace(submittedChecksum, "123456"), hashedKey: hashedKey });
    expect(verificationResult).toBe(false);
  })
});
