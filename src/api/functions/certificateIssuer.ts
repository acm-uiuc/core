import {
  KMSClient,
  SignCommand,
  GetPublicKeyCommand,
} from "@aws-sdk/client-kms";
import { type ValidLoggers } from "api/types.js";
import { genericConfig } from "common/config.js";
import { InternalServerError, ValidationError } from "common/errors/index.js";
import { randomBytes, createPublicKey } from "crypto";

export interface SignSshCertParams {
  principals: string[];
  identity: string;
  kmsKeyId: string;
  userPubKeyString: string;
  validForSeconds: number;
  logger: ValidLoggers;
}

// Encodes data into the SSH wire format [uint32 length][data]
function createSshString(data: Buffer | string): Buffer {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(buf.length, 0);
  return Buffer.concat([len, buf]);
}

// Formats an SSH multiple-precision integer (mpint)
function createSshMpint(buf: Buffer): Buffer {
  // If the most significant bit is 1, prepend a 0x00 byte to keep it positive
  if (buf[0] & 0x80) {
    buf = Buffer.concat([Buffer.alloc(1, 0), buf]);
  }
  return createSshString(buf);
}

export function deconstructRsaPublicKey({
  userPubKeyString,
  logger,
}: {
  userPubKeyString: string;
  logger: ValidLoggers;
}) {
  const parts = userPubKeyString.trim().split(/\s+/);
  if (parts.length < 2) {
    logger.error("ssh-cert: malformed SSH public key string");
    throw new ValidationError({
      message:
        "Malformed SSH public key string: expected '<type> <base64> [comment]'.",
    });
  }
  const [keyType, base64Key] = parts;
  if (keyType !== "ssh-rsa") {
    logger.error("ssh-cert: unsupported key type, only ssh-rsa is supported");
    throw new ValidationError({
      message: `Unsupported SSH key type '${keyType}': only ssh-rsa is supported.`,
    });
  }
  return { keyType, base64Key };
}

export async function signSshCertificateWithKMS({
  principals,
  identity,
  kmsKeyId,
  userPubKeyString,
  validForSeconds,
  logger,
}: SignSshCertParams): Promise<Buffer> {
  const logCtx = { principals };
  logger.info(logCtx, "ssh-cert: starting certificate signing");

  const { keyType, base64Key } = deconstructRsaPublicKey({
    userPubKeyString,
    logger,
  });
  const userPubKeyBuffer = Buffer.from(base64Key, "base64");
  logger.trace(
    { ...logCtx, keyType },
    "ssh-cert: parsed SSH public key string into wire-format buffer",
  );

  // Parse e and n from the SSH wire-format blob
  function parseSshRsaPublicKey(buf: Buffer): { e: Buffer; n: Buffer } {
    let offset = 0;
    const readString = () => {
      const len = buf.readUInt32BE(offset);
      offset += 4;
      const val = buf.subarray(offset, offset + len);
      offset += len;
      return val;
    };
    readString(); // key type: "ssh-rsa"
    const e = readString();
    const n = readString();
    return { e, n };
  }

  const { e: userE, n: userN } = parseSshRsaPublicKey(userPubKeyBuffer);
  logger.trace(logCtx, "ssh-cert: parsed user public key e and n components");

  const kms = new KMSClient({ region: genericConfig.AwsRegion });

  // 1. Fetch the CA Public Key from KMS and convert DER to SSH format
  logger.debug({ kmsKeyId }, "ssh-cert: fetching CA public key from KMS");
  const pubKeyRes = await kms
    .send(new GetPublicKeyCommand({ KeyId: kmsKeyId }))
    .catch((err: Error) => {
      logger.error(
        { ...logCtx, err: err.message },
        "ssh-cert: failed to retrieve CA public key from KMS",
      );
      throw err;
    });

  if (!pubKeyRes.PublicKey) {
    logger.error(logCtx, "ssh-cert: KMS returned empty public key");
    throw new InternalServerError({
      message: "Failed to retrieve KMS public key.",
    });
  }
  logger.debug(
    { kmsKeyId, keySpec: pubKeyRes.KeySpec },
    "ssh-cert: successfully retrieved CA public key",
  );

  const jwk = createPublicKey({
    key: Buffer.from(pubKeyRes.PublicKey),
    format: "der",
    type: "spki",
  }).export({ format: "jwk" });

  const caPubKeyBuffer = Buffer.concat([
    createSshString("ssh-rsa"),
    createSshMpint(Buffer.from(jwk.e as string, "base64url")),
    createSshMpint(Buffer.from(jwk.n as string, "base64url")),
  ]);

  // 2. Calculate Validity Windows
  const nowSeconds = Math.floor(Date.now() / 1000);
  const validAfter = nowSeconds;
  const validBefore = nowSeconds + validForSeconds;

  const validAfterBuf = Buffer.alloc(8);
  validAfterBuf.writeBigUInt64BE(BigInt(validAfter), 0);
  const validBeforeBuf = Buffer.alloc(8);
  validBeforeBuf.writeBigUInt64BE(BigInt(validBefore), 0);

  logger.trace(
    {
      ...logCtx,
      validAfter: new Date(validAfter * 1000).toISOString(),
      validBefore: new Date(validBefore * 1000).toISOString(),
      validForSeconds,
    },
    "ssh-cert: computed certificate validity window",
  );

  // 3. Construct the To-Be-Signed (TBS) Buffer
  logger.trace(logCtx, "ssh-cert: constructing TBS certificate buffer");

  const serialBuf = Buffer.alloc(8);
  serialBuf.writeBigUInt64BE(0n, 0);
  const typeBuf = Buffer.alloc(4);
  typeBuf.writeUInt32BE(1, 0); // 1 = User Certificate

  const extensionsData = Buffer.concat([
    createSshString("permit-X11-forwarding"),
    createSshString(Buffer.alloc(0)),
    createSshString("permit-agent-forwarding"),
    createSshString(Buffer.alloc(0)),
    createSshString("permit-port-forwarding"),
    createSshString(Buffer.alloc(0)),
    createSshString("permit-pty"),
    createSshString(Buffer.alloc(0)),
    createSshString("permit-user-rc"),
    createSshString(Buffer.alloc(0)),
  ]);

  const tbsCertBuffer = Buffer.concat([
    createSshString("rsa-sha2-256-cert-v01@openssh.com"), // must match rsa-sha2-256 signing algorithm
    createSshString(randomBytes(32)), // 32-byte nonce
    createSshMpint(userE), // user public key e component
    createSshMpint(userN), // user public key n component
    serialBuf,
    typeBuf,
    createSshString(identity),
    createSshString(Buffer.concat(principals.map(createSshString))),
    validAfterBuf,
    validBeforeBuf,
    createSshString(Buffer.alloc(0)), // Critical options
    createSshString(extensionsData),
    createSshString(Buffer.alloc(0)), // Reserved
    createSshString(caPubKeyBuffer), // CA Signature Key
  ]);

  logger.trace(
    { ...logCtx, tbsSizeBytes: tbsCertBuffer.length },
    "ssh-cert: TBS buffer constructed",
  );

  // 4. Sign the payload
  logger.trace(
    { ...logCtx, signingAlgorithm: "RSASSA_PKCS1_V1_5_SHA_256" },
    "ssh-cert: requesting KMS signature",
  );

  const signCommand = new SignCommand({
    KeyId: kmsKeyId,
    Message: tbsCertBuffer,
    MessageType: "RAW",
    SigningAlgorithm: "RSASSA_PKCS1_V1_5_SHA_256",
  });

  const { Signature } = await kms.send(signCommand).catch((err: Error) => {
    logger.error(
      { ...logCtx, err: err.message },
      "ssh-cert: KMS signing request failed",
    );
    throw err;
  });

  if (!Signature) {
    logger.error(logCtx, "ssh-cert: KMS returned empty signature");
    throw new InternalServerError({
      message: "KMS signature generation failed.",
    });
  }
  logger.debug(logCtx, "ssh-cert: KMS signature received successfully");

  // 5. Build and append the final SSH signature block
  const outerSignatureBlock = createSshString(
    Buffer.concat([
      createSshString("rsa-sha2-256"),
      createSshString(Buffer.from(Signature)),
    ]),
  );

  const certBuffer = Buffer.concat([tbsCertBuffer, outerSignatureBlock]);

  logger.info(
    { ...logCtx, certSizeBytes: certBuffer.length },
    "ssh-cert: certificate signed and assembled successfully",
  );

  return certBuffer;
}
