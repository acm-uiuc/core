import { getSecretValue } from "../plugins/auth.js";
import {
  ConfigType,
  genericConfig,
  SecretConfig,
} from "../../common/config.js";
import {
  InternalServerError,
  UnauthorizedError,
} from "../../common/errors/index.js";
import icon from "../resources/MembershipPass.pkpass/icon.png";
import logo from "../resources/MembershipPass.pkpass/logo.png";
import strip from "../resources/MembershipPass.pkpass/strip.png";
import pass from "../resources/MembershipPass.pkpass/pass.js";
import { PKPass } from "passkit-generator";
import { promises as fs } from "fs";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { RunEnvironment } from "common/roles.js";
import pino from "pino";
import { createAuditLogEntry } from "./auditLog.js";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

function trim(s: string) {
  return (s || "").replace(/^\s+|\s+$/g, "");
}

function convertName(name: string): string {
  if (!name.includes(",")) {
    return name;
  }
  return `${trim(name.split(",")[1])} ${name.split(",")[0]}`;
}

export async function issueAppleWalletMembershipCard(
  clients: { smClient: SecretsManagerClient },
  environmentConfig: ConfigType,
  runEnvironment: RunEnvironment,
  email: string,
  initiator: string,
  logger: pino.Logger,
  name?: string,
) {
  if (!email.endsWith("@illinois.edu")) {
    throw new UnauthorizedError({
      message:
        "Cannot issue membership pass for emails not on the illinois.edu domain.",
    });
  }
  const secretApiConfig = (await getSecretValue(
    clients.smClient,
    genericConfig.ConfigSecretName,
  )) as SecretConfig;
  if (!secretApiConfig) {
    throw new InternalServerError({
      message: "Could not retrieve signing data",
    });
  }
  const signerCert = Buffer.from(
    secretApiConfig.acm_passkit_signerCert_base64,
    "base64",
  ).toString("utf-8");
  const signerKey = Buffer.from(
    secretApiConfig.acm_passkit_signerKey_base64,
    "base64",
  ).toString("utf-8");
  const wwdr = Buffer.from(
    secretApiConfig.apple_signing_cert_base64,
    "base64",
  ).toString("utf-8");
  pass["passTypeIdentifier"] = environmentConfig["PasskitIdentifier"];
  const pkpass = new PKPass(
    {
      "icon.png": await fs.readFile(icon),
      "logo.png": await fs.readFile(logo),
      "strip.png": await fs.readFile(strip),
      "pass.json": Buffer.from(JSON.stringify(pass)),
    },
    {
      wwdr,
      signerCert,
      signerKey,
    },
    {
      // logoText: app.runEnvironment === "dev" ? "INVALID Membership Pass" : "Membership Pass",
      serialNumber: environmentConfig["PasskitSerialNumber"],
    },
  );
  pkpass.setBarcodes({
    altText: email.split("@")[0],
    format: "PKBarcodeFormatPDF417",
    message: runEnvironment === "dev" ? `INVALID${email}INVALID` : email,
  });
  const iat = new Date().toLocaleDateString("en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  if (name && name !== "") {
    pkpass.secondaryFields.push({
      label: "Member Name",
      key: "name",
      value: convertName(name),
    });
  }
  if (runEnvironment === "prod") {
    pkpass.backFields.push({
      label: "Verification URL",
      key: "iss",
      value: "https://membership.acm.illinois.edu",
    });
  } else {
    pkpass.backFields.push({
      label: "TESTING ONLY Pass",
      key: "iss",
      value: `Do not honor!`,
    });
  }
  pkpass.backFields.push({ label: "Pass Created On", key: "iat", value: iat });
  pkpass.backFields.push({ label: "Membership ID", key: "id", value: email });
  const buffer = pkpass.getAsBuffer();
  await createAuditLogEntry({
    entry: {
      module: "mobileWallet",
      actor: initiator,
      target: email,
      message: "Created membership verification pass",
    },
  });
  return buffer;
}
