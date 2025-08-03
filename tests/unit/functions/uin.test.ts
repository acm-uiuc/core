import { describe, expect, test } from "vitest";
import { getUinHash } from "../../../src/api/functions/uin.js";

describe("UIN hashing test", async () => {
  test("Hashes are the same as previously run", async () => {
    const pepper = "2c8feda7-17af-4cd1-b783-0097f61a99f9"
    const uin = "123456789";
    const expectedHash = "$argon2id$v=19$m=65536,t=3,p=4$YWNtdWl1Y3Vpbg$nTyHsSnzvhe9+UIVEb/ol+k8dU1qTSEFoui6Hq8KbBY"
    const hashed = await getUinHash({
      pepper, uin
    });
    expect(hashed).toStrictEqual(expectedHash);
  })
  test("Hashes are the same from run to run", async () => {
    const pepper = "c84b88f6-81cb-4748-b4a7-212431e10bbe"
    const uin = "123456789";
    const hashed1 = await getUinHash({
      pepper, uin
    });
    const hashed2 = await getUinHash({
      pepper, uin
    });
    expect(hashed1).toStrictEqual(hashed2);
  })
  test("Hashes are different from run to run", async () => {
    const pepper = "c84b88f6-81cb-4748-b4a7-212431e10bbe"
    const uin = "123456789";
    const hashed1 = await getUinHash({
      pepper, uin
    });
    const hashed2 = await getUinHash({
      pepper, uin: "987654321"
    });
    expect(hashed1).not.toStrictEqual(hashed2);
  })
})
