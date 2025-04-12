import { SecretConfig } from "../../src/common/config.js";

const secretObject = {
  jwt_key: "somethingreallysecret",
  discord_guild_id: "12345",
  discord_bot_token: "12345",
  entra_id_private_key: "",
  entra_id_thumbprint: "",
  acm_passkit_signerCert_base64: "",
  acm_passkit_signerKey_base64: "",
  apple_signing_cert_base64: "",
} as SecretConfig & { jwt_key: string };

const secretJson = JSON.stringify(secretObject);

const jwtPayload = {
  aud: "custom_jwt",
  iss: "custom_jwt",
  iat: Math.floor(Date.now() / 1000),
  nbf: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600 * 24, // Token expires after 24 hour
  acr: "1",
  aio: "AXQAi/8TAAAA",
  amr: ["pwd"],
  appid: "your-app-id",
  appidacr: "1",
  email: "infra-unit-test@acm.illinois.edu",
  groups: ["0"],
  roles: ["manage:links", "admin:links"], // Add roles here
  idp: "https://login.microsoftonline.com",
  ipaddr: "192.168.1.1",
  name: "John Doe",
  oid: "00000000-0000-0000-0000-000000000000",
  rh: "rh-value",
  scp: "user_impersonation",
  sub: "subject",
  tid: "tenant-id",
  unique_name: "infra-unit-test@acm.illinois.edu",
  uti: "uti-value",
  ver: "1.0",
};

const jwtPayloadNoGroups = {
  aud: "custom_jwt",
  iss: "custom_jwt",
  iat: Math.floor(Date.now() / 1000),
  nbf: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600 * 24, // Token expires after 24 hour
  acr: "1",
  aio: "AXQAi/8TAAAA",
  amr: ["pwd"],
  appid: "your-app-id",
  appidacr: "1",
  email: "infra-unit-test-nogrp@acm.illinois.edu",
  groups: [],
  idp: "https://login.microsoftonline.com",
  ipaddr: "192.168.1.1",
  name: "John Doe",
  oid: "00000000-0000-0000-0000-000000000000",
  rh: "rh-value",
  scp: "user_impersonation",
  sub: "subject",
  tid: "tenant-id",
  unique_name: "infra-unit-test@acm.illinois.edu",
  uti: "uti-value",
  ver: "1.0",
};

export { secretJson, secretObject, jwtPayload, jwtPayloadNoGroups };
