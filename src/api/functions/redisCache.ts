import { DecryptionError } from "common/errors/index.js";
import type RedisModule from "ioredis";
import { z } from "zod";
import { decrypt, encrypt } from "./encryption.js";

export type GetFromCacheInput = {
  redisClient: RedisModule.default;
  key: string;
  encryptionSecret?: string;
};

export type SetInCacheInput = {
  redisClient: RedisModule.default;
  key: string;
  data: string;
  expiresIn?: number;
  encryptionSecret?: string;
};

const redisEntrySchema = z.object({
  isEncrypted: z.boolean(),
  data: z.string(),
});

export async function getKey<T extends object>({
  redisClient,
  key,
  encryptionSecret,
}: GetFromCacheInput): Promise<T | null> {
  const data = await redisClient.get(key);
  if (!data) {
    return null;
  }
  const decoded = await redisEntrySchema.parseAsync(JSON.parse(data));
  if (!decoded.isEncrypted) {
    return JSON.parse(decoded.data) as T;
  }
  if (!encryptionSecret) {
    throw new DecryptionError({
      message: "Encrypted data found but no decryption key provided.",
    });
  }
  const decryptedData = decrypt({ cipherText: decoded.data, encryptionSecret });
  return JSON.parse(decryptedData) as T;
}

export async function setKey({
  redisClient,
  key,
  encryptionSecret,
  data,
  expiresIn,
}: SetInCacheInput) {
  const realData = encryptionSecret
    ? encrypt({ plaintext: data, encryptionSecret })
    : data;
  const redisPayload: z.infer<typeof redisEntrySchema> = {
    isEncrypted: !!encryptionSecret,
    data: realData,
  };
  const strRedisPayload = JSON.stringify(redisPayload);
  return expiresIn
    ? await redisClient.set(key, strRedisPayload, "EX", expiresIn)
    : await redisClient.set(key, strRedisPayload);
}
