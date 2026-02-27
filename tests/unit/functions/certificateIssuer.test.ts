import { describe, expect, test, vi, beforeEach } from "vitest";
import { KMSClient, SignCommand, GetPublicKeyCommand } from "@aws-sdk/client-kms";
import { mockClient } from "aws-sdk-client-mock";
import { signSshCertificateWithKMS } from "../../../src/api/functions/certificateIssuer.js";
import { InternalServerError } from "../../../src/common/errors/index.js";
import { ValidLoggers } from "../../../src/api/types.js";
import { createPublicKey, generateKeyPairSync, createSign } from "crypto";

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn(),
  silent: vi.fn(),
  level: "debug",
} as unknown as ValidLoggers;

const kmsMock = mockClient(KMSClient);

// Generate a real RSA key pair for deterministic testing
const { publicKey: caPublicKey, privateKey: caPrivateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

const caDerPublicKey = caPublicKey.export({ format: "der", type: "spki" });

// Generate a user RSA key pair and format as SSH public key string
const { publicKey: userPublicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

function rsaPublicKeyToSshString(pubKey: ReturnType<typeof createPublicKey>): string {
  const jwk = pubKey.export({ format: "jwk" });
  const e = Buffer.from(jwk.e as string, "base64url");
  const n = Buffer.from(jwk.n as string, "base64url");

  const writeSshString = (data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    return Buffer.concat([len, data]);
  };

  const writeSshMpint = (buf: Buffer): Buffer => {
    if (buf[0] & 0x80) {
      buf = Buffer.concat([Buffer.alloc(1, 0), buf]);
    }
    return writeSshString(buf);
  };

  const blob = Buffer.concat([
    writeSshString(Buffer.from("ssh-rsa")),
    writeSshMpint(e),
    writeSshMpint(n),
  ]);

  return `ssh-rsa ${blob.toString("base64")} test@test`;
}

const userSshPubKeyString = rsaPublicKeyToSshString(userPublicKey);

// Helper to parse SSH wire-format strings from a certificate buffer
function parseSshCert(certBuf: Buffer) {
  let offset = 0;

  const readUint32 = (): number => {
    const val = certBuf.readUInt32BE(offset);
    offset += 4;
    return val;
  };

  const readString = (): Buffer => {
    const len = readUint32();
    const val = certBuf.subarray(offset, offset + len);
    offset += len;
    return val;
  };

  const readUint64 = (): bigint => {
    const val = certBuf.readBigUInt64BE(offset);
    offset += 8;
    return val;
  };

  const certType = readString().toString(); // cert type string
  const nonce = readString(); // nonce

  // For RSA certs: e then n as mpints
  const e = readString(); // e (mpint, includes leading zero if needed)
  const n = readString(); // n (mpint)

  const serial = readUint64();
  const type = readUint32(); // 1 = user, 2 = host
  const keyId = readString().toString();

  // principals is a nested string of strings
  const principalsBuf = readString();
  const principals: string[] = [];
  let pOffset = 0;
  while (pOffset < principalsBuf.length) {
    const pLen = principalsBuf.readUInt32BE(pOffset);
    pOffset += 4;
    principals.push(principalsBuf.subarray(pOffset, pOffset + pLen).toString());
    pOffset += pLen;
  }

  const validAfter = readUint64();
  const validBefore = readUint64();
  const criticalOptions = readString();
  const extensions = readString();
  const reserved = readString();
  const signatureKey = readString();

  // The outer signature block
  const signatureBlock = readString();

  return {
    certType,
    nonce,
    e,
    n,
    serial,
    type,
    keyId,
    principals,
    validAfter,
    validBefore,
    criticalOptions,
    extensions,
    reserved,
    signatureKey,
    signatureBlock,
    totalParsedBytes: offset,
  };
}

function parseExtensions(extBuf: Buffer): Record<string, Buffer> {
  const result: Record<string, Buffer> = {};
  let offset = 0;
  while (offset < extBuf.length) {
    const nameLen = extBuf.readUInt32BE(offset);
    offset += 4;
    const name = extBuf.subarray(offset, offset + nameLen).toString();
    offset += nameLen;
    const valLen = extBuf.readUInt32BE(offset);
    offset += 4;
    const val = extBuf.subarray(offset, offset + valLen);
    offset += valLen;
    result[name] = val;
  }
  return result;
}

describe("signSshCertificateWithKMS", () => {
  beforeEach(() => {
    kmsMock.reset();
    vi.clearAllMocks();
  });

  function setupKmsMock() {
    kmsMock.on(GetPublicKeyCommand).resolves({
      PublicKey: new Uint8Array(caDerPublicKey),
      KeySpec: "RSA_2048",
    });

    kmsMock.on(SignCommand).callsFake(async (input) => {
      const signer = createSign("SHA256");
      signer.update(Buffer.from(input.Message as Uint8Array));
      const signature = signer.sign({
        key: caPrivateKey,
        padding: 1, // RSA_PKCS1_PADDING
      });
      return { Signature: new Uint8Array(signature) };
    });
  }

  const userGroups = ["0b606168-4cf6-4fa2-acaa-182b7bccc9b5", "b2e12c10-e4ab-4159-aae5-8f141a82ac58"];

  const identityRaw = {
    sub: "infra-unit-test@illinois.edu",
    email: "infra-unit-test@illinois.edu",
    login: "infra-unit-test", // e.g. "alice" from "alice@company.com"
    groups: userGroups,
    iat: Math.floor(Date.now() / 1000),
  };

  const identity = Buffer.from(JSON.stringify(identityRaw)).toString(
    "base64",
  );
  const defaultParams = {
    principals: userGroups,
    identity,
    kmsKeyId: "arn:aws:kms:us-east-1:123456789012:key/test-key-id",
    userPubKeyString: userSshPubKeyString,
    validForSeconds: 3600,
    logger: mockLogger,
  };

  test("produces a valid SSH certificate with correct structure", async () => {
    setupKmsMock();

    const certBuffer = await signSshCertificateWithKMS(defaultParams);

    expect(certBuffer).toBeInstanceOf(Buffer);
    expect(certBuffer.length).toBeGreaterThan(0);

    const parsed = parseSshCert(certBuffer);

    // Verify cert type
    expect(parsed.certType).toBe("rsa-sha2-256-cert-v01@openssh.com");

    // Nonce should be 32 bytes
    expect(parsed.nonce.length).toBe(32);

    // Type 1 = user certificate
    expect(parsed.type).toBe(1);

    // Serial should be 0
    expect(parsed.serial).toBe(0n);

    // Key ID matches identity
    expect(parsed.keyId).toBe(identity);

    // Principals match
    expect(parsed.principals).toEqual(userGroups);

    // Entire buffer should be consumed
    expect(parsed.totalParsedBytes).toBe(certBuffer.length);
  });

  test("validity window is correct", async () => {
    setupKmsMock();

    const beforeSign = Math.floor(Date.now() / 1000);
    const certBuffer = await signSshCertificateWithKMS(defaultParams);
    const afterSign = Math.floor(Date.now() / 1000);

    const parsed = parseSshCert(certBuffer);

    const validAfter = Number(parsed.validAfter);
    const validBefore = Number(parsed.validBefore);

    expect(validAfter).toBeGreaterThanOrEqual(beforeSign);
    expect(validAfter).toBeLessThanOrEqual(afterSign);
    expect(validBefore - validAfter).toBe(3600);
  });

  test("extensions include expected permissions", async () => {
    setupKmsMock();

    const certBuffer = await signSshCertificateWithKMS(defaultParams);
    const parsed = parseSshCert(certBuffer);
    const extensions = parseExtensions(parsed.extensions);

    expect(Object.keys(extensions)).toEqual([
      "permit-X11-forwarding",
      "permit-agent-forwarding",
      "permit-port-forwarding",
      "permit-pty",
      "permit-user-rc",
    ]);
  });

  test("critical options are empty", async () => {
    setupKmsMock();

    const certBuffer = await signSshCertificateWithKMS(defaultParams);
    const parsed = parseSshCert(certBuffer);

    expect(parsed.criticalOptions.length).toBe(0);
  });

  test("signature block uses rsa-sha2-256 algorithm", async () => {
    setupKmsMock();

    const certBuffer = await signSshCertificateWithKMS(defaultParams);
    const parsed = parseSshCert(certBuffer);

    // Parse the inner signature block: [string algo][string sig]
    let offset = 0;
    const algoLen = parsed.signatureBlock.readUInt32BE(offset);
    offset += 4;
    const algo = parsed.signatureBlock.subarray(offset, offset + algoLen).toString();
    expect(algo).toBe("rsa-sha2-256");
  });

  test("CA public key in cert matches KMS key", async () => {
    setupKmsMock();

    const certBuffer = await signSshCertificateWithKMS(defaultParams);
    const parsed = parseSshCert(certBuffer);

    // Parse the CA signature key: [string "ssh-rsa"][mpint e][mpint n]
    let offset = 0;
    const readStr = () => {
      const len = parsed.signatureKey.readUInt32BE(offset);
      offset += 4;
      const val = parsed.signatureKey.subarray(offset, offset + len);
      offset += len;
      return val;
    };

    const caKeyType = readStr().toString();
    expect(caKeyType).toBe("ssh-rsa");

    // The rest are e and n mpints - just verify they exist
    const caE = readStr();
    const caN = readStr();
    expect(caE.length).toBeGreaterThan(0);
    expect(caN.length).toBeGreaterThan(0);

    // Verify against the original CA key JWK
    const caJwk = caPublicKey.export({ format: "jwk" });
    const expectedE = Buffer.from(caJwk.e as string, "base64url");
    const expectedN = Buffer.from(caJwk.n as string, "base64url");

    // Strip leading zero byte from mpint if present
    const stripLeadingZero = (buf: Buffer) =>
      buf[0] === 0 ? buf.subarray(1) : buf;

    expect(stripLeadingZero(caE)).toEqual(expectedE);
    expect(stripLeadingZero(caN)).toEqual(expectedN);
  });

  test("user public key components are embedded correctly", async () => {
    setupKmsMock();

    const certBuffer = await signSshCertificateWithKMS(defaultParams);
    const parsed = parseSshCert(certBuffer);

    const userJwk = userPublicKey.export({ format: "jwk" });
    const expectedE = Buffer.from(userJwk.e as string, "base64url");
    const expectedN = Buffer.from(userJwk.n as string, "base64url");

    const stripLeadingZero = (buf: Buffer) =>
      buf[0] === 0 ? buf.subarray(1) : buf;

    expect(stripLeadingZero(parsed.e)).toEqual(expectedE);
    expect(stripLeadingZero(parsed.n)).toEqual(expectedN);
  });

  test("signature is cryptographically valid over TBS data", async () => {
    setupKmsMock();

    const certBuffer = await signSshCertificateWithKMS(defaultParams);
    const parsed = parseSshCert(certBuffer);

    // The TBS data is everything before the outer signature block
    // The outer sig block is: [uint32 len][inner block]
    // We can compute the TBS length as totalParsedBytes minus the outer sig block
    const outerSigBlockLen = parsed.signatureBlock.length;
    // outer sig block on wire: 4 bytes for outer length + outer content
    // outer content = 4 bytes inner length + inner content
    const outerWireLen = 4 + 4 + outerSigBlockLen; // outer length prefix + inner length prefix + inner data
    // Actually: the outer block is createSshString(innerBlock), so on wire it's [4-byte len][innerBlock]
    // innerBlock = createSshString(algo) + createSshString(rawSig)
    // Let's just compute TBS as certBuffer minus the last ssh-string
    const tbsEnd = certBuffer.length - 4 - outerSigBlockLen;
    const tbsData = certBuffer.subarray(0, tbsEnd);

    // Extract raw signature from the signature block
    let offset = 0;
    const algoLen = parsed.signatureBlock.readUInt32BE(offset);
    offset += 4 + algoLen;
    const sigLen = parsed.signatureBlock.readUInt32BE(offset);
    offset += 4;
    const rawSig = parsed.signatureBlock.subarray(offset, offset + sigLen);

    // Verify signature using the CA public key
    const { createVerify } = await import("crypto");
    const verifier = createVerify("SHA256");
    verifier.update(tbsData);
    const isValid = verifier.verify(
      { key: caPublicKey, padding: 1 },
      rawSig,
    );

    expect(isValid).toBe(true);
  });

  test("throws on malformed SSH public key string", async () => {
    setupKmsMock();

    await expect(
      signSshCertificateWithKMS({
        ...defaultParams,
        userPubKeyString: "not-a-valid-key",
      }),
    ).rejects.toThrow(InternalServerError);

    await expect(
      signSshCertificateWithKMS({
        ...defaultParams,
        userPubKeyString: "not-a-valid-key",
      }),
    ).rejects.toThrow("Malformed SSH public key string");
  });

  test("throws on unsupported key type", async () => {
    setupKmsMock();

    await expect(
      signSshCertificateWithKMS({
        ...defaultParams,
        userPubKeyString: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFake test@test",
      }),
    ).rejects.toThrow(InternalServerError);

    await expect(
      signSshCertificateWithKMS({
        ...defaultParams,
        userPubKeyString: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFake test@test",
      }),
    ).rejects.toThrow("Unsupported SSH key type");
  });

  test("throws when KMS GetPublicKey fails", async () => {
    kmsMock.on(GetPublicKeyCommand).rejects(new Error("KMS unavailable"));

    await expect(
      signSshCertificateWithKMS(defaultParams),
    ).rejects.toThrow("KMS unavailable");
  });

  test("throws when KMS returns empty public key", async () => {
    kmsMock.on(GetPublicKeyCommand).resolves({ PublicKey: undefined });

    await expect(
      signSshCertificateWithKMS(defaultParams),
    ).rejects.toThrow(InternalServerError);
  });

  test("throws when KMS Sign fails", async () => {
    kmsMock.on(GetPublicKeyCommand).resolves({
      PublicKey: new Uint8Array(caDerPublicKey),
      KeySpec: "RSA_2048",
    });
    kmsMock.on(SignCommand).rejects(new Error("Signing failed"));

    await expect(
      signSshCertificateWithKMS(defaultParams),
    ).rejects.toThrow("Signing failed");
  });

  test("throws when KMS returns empty signature", async () => {
    kmsMock.on(GetPublicKeyCommand).resolves({
      PublicKey: new Uint8Array(caDerPublicKey),
      KeySpec: "RSA_2048",
    });
    kmsMock.on(SignCommand).resolves({ Signature: undefined });

    await expect(
      signSshCertificateWithKMS(defaultParams),
    ).rejects.toThrow(InternalServerError);
  });

  test("produces different nonces on consecutive calls", async () => {
    setupKmsMock();

    const cert1 = await signSshCertificateWithKMS(defaultParams);
    const cert2 = await signSshCertificateWithKMS(defaultParams);

    const parsed1 = parseSshCert(cert1);
    const parsed2 = parseSshCert(cert2);

    expect(parsed1.nonce).not.toEqual(parsed2.nonce);
  });

  test("handles single principal correctly", async () => {
    setupKmsMock();

    const certBuffer = await signSshCertificateWithKMS({
      ...defaultParams,
      principals: ["single-user"],
    });

    const parsed = parseSshCert(certBuffer);
    expect(parsed.principals).toEqual(["single-user"]);
  });
});
