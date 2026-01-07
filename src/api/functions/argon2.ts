import { argon2, timingSafeEqual, randomBytes } from "node:crypto";
import { promisify } from "node:util";

export enum Algorithm {
  Argon2d = "argon2d",
  Argon2i = "argon2i",
  Argon2id = "argon2id",
}

export enum Version {
  V0x10 = 0x10,
  V0x13 = 0x13,
}

export interface Argon2Options {
  algorithm?: Algorithm;
  version?: Version;
  memoryCost?: number;
  timeCost?: number;
  parallelism?: number;
  outputLen?: number;
  salt?: Buffer;
  saltLength?: number;
  secret?: Buffer;
}

const DEFAULTS = {
  algorithm: Algorithm.Argon2id,
  version: Version.V0x13,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  outputLen: 32,
  saltLength: 16,
} as const;

const argon2Promise = promisify(argon2);

/**
 * Hash a password using Argon2 and return a PHC formatted string.
 * Uses node-argon2 defaults if options are omitted.
 */
export async function hash(
  message: string | Buffer,
  options: Argon2Options = {},
) {
  const config = { ...DEFAULTS, ...options };
  const salt = config.salt || randomBytes(config.saltLength);
  const derivedKey = await argon2Promise(config.algorithm, {
    message,
    nonce: salt,
    secret: config.secret,
    parallelism: config.parallelism,
    memory: config.memoryCost,
    passes: config.timeCost,
    tagLength: config.outputLen,
  });

  const b64Salt = salt.toString("base64").replace(/=/g, "");
  const b64Hash = derivedKey.toString("base64").replace(/=/g, "");
  return `$${config.algorithm}$v=${config.version}$m=${config.memoryCost},t=${config.timeCost},p=${config.parallelism}$${b64Salt}$${b64Hash}`;
}

/**
 * Verify a password against a PHC formatted Argon2 hash string.
 */
export async function verify(
  phcString: string,
  password: string | Buffer,
  secret?: Buffer,
) {
  try {
    const parts = phcString.split("$");
    if (parts.length !== 6) {
      return false;
    }

    const algorithm = parts[1] as Algorithm;
    // We don't strictly validate the version for calculation, but you could check parts[2] here.

    // Parse Parameters (m, t, p)
    const paramStr = parts[3];
    const params = Object.fromEntries(
      paramStr.split(",").map((p) => p.split("=")),
    );

    const memory = parseInt(params.m, 10);
    const passes = parseInt(params.t, 10);
    const parallelism = parseInt(params.p, 10);

    if (isNaN(memory) || isNaN(passes) || isNaN(parallelism)) {
      return false;
    }

    // Decode Salt and Hash
    // Buffer.from handles unpadded base64 correctly in Node
    const salt = Buffer.from(parts[4], "base64");
    const expectedHash = Buffer.from(parts[5], "base64");

    // Re-hash the input password using the extracted parameters
    const calculatedHash = await argon2Promise(algorithm, {
      message: password,
      nonce: salt,
      secret,
      parallelism,
      memory,
      passes,
      tagLength: expectedHash.length,
    });

    return timingSafeEqual(calculatedHash, expectedHash);
  } catch (err) {
    return false;
  }
}
