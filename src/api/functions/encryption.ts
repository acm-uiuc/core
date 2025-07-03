import { DecryptionError } from "common/errors/index.js";
import crypto, { createDecipheriv, pbkdf2Sync } from "node:crypto";

const VALID_PREFIX = "VALID:";
const ITERATIONS = 100000;
const KEY_LEN = 32;
const ALGORITHM = "aes-256-gcm";
const HASH_FUNCTION = "sha512";

export const INVALID_DECRYPTION_MESSAGE =
  "Could not decrypt data (check that the encryption secret is correct).";

export function encrypt({
  plaintext,
  encryptionSecret,
}: {
  plaintext: string;
  encryptionSecret: string;
}) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(
    encryptionSecret,
    salt,
    ITERATIONS,
    KEY_LEN,
    HASH_FUNCTION,
  );
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(`${VALID_PREFIX}${plaintext}`, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, encrypted]).toString("hex");
}

export function decrypt({
  cipherText,
  encryptionSecret,
}: {
  cipherText: string;
  encryptionSecret: string;
}): string {
  const data = Buffer.from(cipherText, "hex");
  const salt = data.subarray(0, 16);
  const iv = data.subarray(16, 28);
  const tag = data.subarray(28, 44);
  const encryptedText = data.subarray(44);

  const key = pbkdf2Sync(
    encryptionSecret,
    salt,
    ITERATIONS,
    KEY_LEN,
    HASH_FUNCTION,
  );
  let decipher, decryptedBuffer;
  try {
    decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    decryptedBuffer = Buffer.concat([
      decipher.update(encryptedText),
      decipher.final(),
    ]);
  } catch (e) {
    throw new DecryptionError({
      message: INVALID_DECRYPTION_MESSAGE,
    });
  }

  const candidate = decryptedBuffer.toString("utf8");
  if (candidate.substring(0, VALID_PREFIX.length) !== VALID_PREFIX) {
    throw new DecryptionError({
      message: "Encrypted data is corrupted.",
    });
  }
  return candidate.substring(VALID_PREFIX.length, candidate.length);
}
