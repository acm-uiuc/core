import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { getSsmParameter } from "../common/index.js";

async function getSecrets() {
  const data = await getSsmParameter("/infra-core-api/jwt_key");
  if (!data) {
    throw new Error("Failed to get JWT key.");
  }
  return { JWTKEY: data };
}

export async function createJwt(
  username: string = "infra@acm.illinois.edu",
  groups: string[] = ["0"],
) {
  const secretData = await getSecrets();
  const payload = {
    aud: "custom_jwt",
    iss: "custom_jwt",
    iat: Math.floor(Date.now() / 1000),
    nbf: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600 * 1, // Token expires after 1 hour
    acr: "1",
    aio: "AXQAi/8TAAAA",
    amr: ["pwd"],
    appid: "your-app-id",
    appidacr: "1",
    email: username,
    groups,
    idp: "https://login.microsoftonline.com",
    ipaddr: "192.168.1.1",
    name: "Doe, John",
    oid: "00000000-0000-0000-0000-000000000000",
    rh: "rh-value",
    scp: "user_impersonation",
    sub: "subject",
    tid: "tenant-id",
    unique_name: username,
    uti: randomUUID().toString(),
    ver: "1.0",
  };
  const token = jwt.sign(payload, secretData.JWTKEY, { algorithm: "HS256" });
  return token;
}

type Service = "core" | "go" | "ical" | "infra.go";

export function getBaseEndpoint(service?: Service) {
  const base = process.env.CORE_BASE_URL ?? "https://core.aws.qa.acmuiuc.org";
  if (
    base.includes("localhost") ||
    base.includes("127.0.0.1") ||
    base.includes("::1") ||
    !service
  ) {
    return base;
  }
  return base.replace("core", service);
}

export function makeRandomString(length: number) {
  var result = "";
  var characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var charactersLength = characters.length;
  for (var i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
