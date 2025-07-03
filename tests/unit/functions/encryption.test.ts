import { randomUUID } from "crypto";
import { describe, expect, test } from "vitest";
import { decrypt, encrypt } from "../../../src/api/functions/encryption.js";
import { DecryptionError } from "../../../src/common/errors/index.js";

describe("Encryption tests", () => {
  test("Encryption matches decryption", () => {
    const plaintext = randomUUID();
    const encryptionSecret = randomUUID();
    const cipherText = encrypt({ plaintext, encryptionSecret });
    expect(cipherText === plaintext).toBe(false);
    const decryptedText = decrypt({ cipherText, encryptionSecret });
    expect(decryptedText === plaintext).toBe(true);
  })
  test("Invalid decryption key throws an error", () => {
    const plaintext = randomUUID();
    const encryptionSecret = randomUUID();
    const cipherText = encrypt({ plaintext, encryptionSecret });
    expect(cipherText === plaintext).toBe(false);
    expect(() => decrypt({ cipherText, encryptionSecret: randomUUID() })).toThrow(DecryptionError);
  })
  test("Corrupted ciphertext throws an error", () => {
    const plaintext = randomUUID();
    const encryptionSecret = randomUUID();
    const cipherText = `abc${encrypt({ plaintext, encryptionSecret })}`;
    expect(cipherText === plaintext).toBe(false);
    expect(() => decrypt({ cipherText, encryptionSecret: randomUUID() })).toThrow(DecryptionError);
  })
})
