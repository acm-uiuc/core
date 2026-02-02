import { vi } from "vitest";
import {
  jwtPayload,
  jwtPayloadNoGroups,
  secretObject,
} from "./secret.testdata.js";
import jwt from "jsonwebtoken";

const jwt_secret = secretObject["jwt_key"];

export function createJwt(date?: Date, groups?: string[], email?: string) {
  let modifiedPayload = {
    ...jwtPayload,
    email: email || jwtPayload.email,
    groups: [...jwtPayload.groups],
  };
  if (date) {
    const nowMs = Math.floor(date.valueOf() / 1000);
    const laterMs = nowMs + 3600 * 24;
    modifiedPayload = {
      ...modifiedPayload,
      iat: nowMs,
      nbf: nowMs,
      exp: laterMs,
    };
  }

  if (groups) {
    modifiedPayload.groups = groups;
  }
  return jwt.sign(modifiedPayload, jwt_secret, { algorithm: "HS256" });
}

export function createJwtNoGroups() {
  const modifiedPayload = jwtPayloadNoGroups;
  return jwt.sign(modifiedPayload, jwt_secret, { algorithm: "HS256" });
}

vi.stubEnv("JwtSigningKey", jwt_secret);
