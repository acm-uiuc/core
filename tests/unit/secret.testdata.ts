import { randomUUID } from "node:crypto";
import { SecretConfig } from "../../src/common/config.js";

const secretObject = {
  discord_bot_token: "12345",
  entra_id_private_key: "",
  entra_id_thumbprint: "",
  stripe_secret_key: "sk_test_12345",
  stripe_endpoint_secret: "whsec_01234",
  stripe_links_endpoint_secret: "whsec_56789",
  acm_passkit_signerCert_base64: "",
  acm_passkit_signerKey_base64: "",
  apple_signing_cert_base64: "",
  redis_url: "",
  github_installation_id: "abc123testing",
  UIN_HASHING_SECRET_PEPPER: "abcd",
  fallback_redis_url: "abc",
  github_app_id: "abc123testing",
  jwt_key: "somethingreallysecret",
} as SecretConfig;

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
  idp: "https://login.microsoftonline.com",
  ipaddr: "192.168.1.1",
  name: "John Doe",
  oid: "00000000-0000-0000-0000-000000000000",
  rh: "rh-value",
  scp: "user_impersonation",
  sub: "subject",
  tid: "tenant-id",
  unique_name: "infra-unit-test@acm.illinois.edu",
  uti: randomUUID(),
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
  uti: randomUUID(),
  ver: "1.0",
};

export { secretJson, secretObject, jwtPayload, jwtPayloadNoGroups };
