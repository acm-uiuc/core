import { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import jwksClient from "jwks-rsa";
import jwt, { Algorithm, Jwt } from "jsonwebtoken";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { AppRoles } from "common/roles.js";
import {
  BaseError,
  InternalServerError,
  UnauthenticatedError,
  UnauthorizedError,
} from "../../common/errors/index.js";
import { SecretConfig } from "../../common/config.js";
import {
  AUTH_DECISION_CACHE_SECONDS,
  getGroupRoles,
  getUserRoles,
} from "../functions/authorization.js";
import { getApiKeyData, getApiKeyParts } from "api/functions/apiKey.js";

export function intersection<T>(setA: Set<T>, setB: Set<T>): Set<T> {
  const _intersection = new Set<T>();
  for (const elem of setB) {
    if (setA.has(elem)) {
      _intersection.add(elem);
    }
  }
  return _intersection;
}
const JWKS_CACHE_SECONDS = 21600; // 6 hours;
export type AadToken = {
  aud: string;
  iss: string;
  iat: number;
  nbf: number;
  exp: number;
  acr: string;
  aio: string;
  amr: string[];
  appid: string;
  appidacr: string;
  email?: string;
  groups?: string[];
  idp: string;
  ipaddr: string;
  name: string;
  oid: string;
  rh: string;
  scp: string;
  sub: string;
  tid: string;
  unique_name: string;
  upn?: string;
  uti: string;
  ver: string;
  roles?: string[];
};

export const getSecretValue = async (
  smClient: SecretsManagerClient,
  secretId: string,
): Promise<Record<string, string | number | boolean> | null | SecretConfig> => {
  const data = await smClient.send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  if (!data.SecretString) {
    return null;
  }
  try {
    return JSON.parse(data.SecretString) as Record<
      string,
      string | number | boolean
    >;
  } catch {
    return null;
  }
};

export const getUserIdentifier = (request: FastifyRequest): string | null => {
  try {
    const apiKeyHeader = request.headers ? request.headers["x-api-key"] : null;
    if (apiKeyHeader) {
      const apiKeyValue =
        typeof apiKeyHeader === "string" ? apiKeyHeader : apiKeyHeader[0];
      const { id } = getApiKeyParts(apiKeyValue);
      return id;
    }
    const authHeader = request.headers ? request.headers.authorization : null;
    if (!authHeader) {
      return request.ip;
    }
    const [method, token] = authHeader.split(" ");
    const decoded = jwt.decode(token);
    if (!decoded || typeof decoded === "string") {
      throw new InternalServerError({ message: "Could not decode JWT." });
    }
    return (decoded as AadToken).sub || null;
  } catch (e) {
    request.log.error("Failed to determine user identifier", e);
    return null;
  }
};

const authPlugin: FastifyPluginAsync = async (fastify, _options) => {
  const handleApiKeyAuthentication = async (
    request: FastifyRequest,
    _reply: FastifyReply,
    validRoles: AppRoles[],
  ): Promise<Set<AppRoles>> => {
    const apiKeyValueTemp = request.headers["x-api-key"];
    if (!apiKeyValueTemp) {
      throw new UnauthenticatedError({
        message: "Invalid API key.",
      });
    }
    const apiKeyValue =
      typeof apiKeyValueTemp === "string"
        ? apiKeyValueTemp
        : apiKeyValueTemp[0];
    const { id: apikeyId } = getApiKeyParts(apiKeyValue);
    const keyData = await getApiKeyData({
      nodeCache: fastify.nodeCache,
      dynamoClient: fastify.dynamoClient,
      id: apikeyId,
    });
    if (!keyData) {
      throw new UnauthenticatedError({
        message: "Invalid API key.",
      });
    }
    const expectedRoles = new Set(validRoles);
    const rolesSet = new Set(keyData.roles);
    if (
      expectedRoles.size > 0 &&
      intersection(rolesSet, expectedRoles).size === 0
    ) {
      throw new UnauthorizedError({
        message: "User does not have the privileges for this task.",
      });
    }
    request.username = `acmuiuc_${apikeyId}`;
    request.userRoles = rolesSet;
    request.tokenPayload = undefined; // there's no token data
    request.policyRestrictions = keyData.restrictions;
    return new Set(keyData.roles);
  };
  fastify.decorate(
    "authorize",
    async (
      request: FastifyRequest,
      reply: FastifyReply,
      validRoles: AppRoles[],
      disableApiKeyAuth: boolean,
    ): Promise<Set<AppRoles>> => {
      const startTime = new Date().getTime();
      try {
        if (!disableApiKeyAuth) {
          const apiKeyHeader = request.headers
            ? request.headers["x-api-key"]
            : null;
          if (apiKeyHeader) {
            return handleApiKeyAuthentication(request, reply, validRoles);
          }
        }

        const authHeader = request.headers
          ? request.headers.authorization
          : null;
        if (!authHeader) {
          throw new UnauthenticatedError({
            message: "Did not find bearer token in expected header.",
          });
        }
        const [method, token] = authHeader.split(" ");
        if (method !== "Bearer") {
          throw new UnauthenticatedError({
            message: `Did not find bearer token, found ${method} token.`,
          });
        }
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const decoded = jwt.decode(token, { complete: true }) as Record<
          string,
          any
        >;
        let signingKey = "";
        let verifyOptions = {};
        if (decoded?.payload.iss === "custom_jwt") {
          if (fastify.runEnvironment === "prod") {
            throw new UnauthenticatedError({
              message: "Custom JWTs cannot be used in Prod environment.",
            });
          }
          signingKey =
            process.env.JwtSigningKey ||
            (fastify.secretConfig.jwt_key as string) ||
            "";
          if (signingKey === "") {
            throw new UnauthenticatedError({
              message: "Invalid token.",
            });
          }
          verifyOptions = { algorithms: ["HS256" as Algorithm] };
        } else {
          const AadClientId = fastify.environmentConfig.AadValidClientId;
          if (!AadClientId) {
            request.log.error(
              "Server is misconfigured, could not find `AadValidClientId`!",
            );
            throw new InternalServerError({
              message:
                "Server authentication is misconfigured, please contact your administrator.",
            });
          }
          const header = decoded?.header;
          if (!header) {
            throw new UnauthenticatedError({
              message: "Could not decode token header.",
            });
          }
          verifyOptions = {
            algorithms: ["RS256" as Algorithm],
            header: decoded?.header,
            audience: `api://${AadClientId}`,
          };
          const cachedJwksSigningKey = await fastify.redisClient.get(
            `jwksKey:${header.kid}`,
          );
          if (cachedJwksSigningKey) {
            signingKey = cachedJwksSigningKey;
            request.log.debug("Got JWKS signing key from cache.");
          } else {
            const client = jwksClient({
              jwksUri:
                "https://login.microsoftonline.com/common/discovery/keys",
            });
            signingKey = (
              await client.getSigningKey(header.kid)
            ).getPublicKey();
            await fastify.redisClient.set(
              `jwksKey:${header.kid}`,
              signingKey,
              "EX",
              JWKS_CACHE_SECONDS,
            );
            request.log.debug("Got JWKS signing key from server.");
          }
        }

        const verifiedTokenData = jwt.verify(
          token,
          signingKey,
          verifyOptions,
        ) as AadToken;
        request.log.debug(
          `Start to verifying JWT took ${new Date().getTime() - startTime} ms.`,
        );
        request.tokenPayload = verifiedTokenData;
        request.username =
          verifiedTokenData.email ||
          verifiedTokenData.upn?.replace("acm.illinois.edu", "illinois.edu") ||
          verifiedTokenData.sub;
        const expectedRoles = new Set(validRoles);
        const cachedRoles = await fastify.redisClient.get(
          `authCache:${request.username}:roles`,
        );
        if (cachedRoles) {
          request.userRoles = new Set(JSON.parse(cachedRoles));
          request.log.debug("Retrieved user roles from cache.");
        } else {
          const userRoles = new Set([] as AppRoles[]);
          if (verifiedTokenData.groups) {
            const groupRoles = await Promise.allSettled(
              verifiedTokenData.groups.map((x) =>
                getGroupRoles(fastify.dynamoClient, x),
              ),
            );
            for (const result of groupRoles) {
              if (result.status === "fulfilled") {
                for (const role of result.value) {
                  userRoles.add(role);
                }
              } else {
                request.log.warn(`Failed to get group roles: ${result.reason}`);
              }
            }
          } else if (
            verifiedTokenData.roles &&
            fastify.environmentConfig.AzureRoleMapping
          ) {
            for (const group of verifiedTokenData.roles) {
              if (fastify.environmentConfig.AzureRoleMapping[group]) {
                for (const role of fastify.environmentConfig.AzureRoleMapping[
                  group
                ]) {
                  userRoles.add(role);
                }
              }
            }
          }
          // add user-specific role overrides
          if (request.username) {
            try {
              const userAuth = await getUserRoles(
                fastify.dynamoClient,
                request.username,
              );
              for (const role of userAuth) {
                userRoles.add(role);
              }
            } catch (e) {
              request.log.warn(
                `Failed to get user role mapping for ${request.username}: ${e}`,
              );
            }
          }
          request.userRoles = userRoles;
          fastify.redisClient.set(
            `authCache:${request.username}:roles`,
            JSON.stringify([...userRoles]),
            "EX",
            AUTH_DECISION_CACHE_SECONDS,
          );
          request.log.debug("Retrieved user roles from database.");
        }
        if (
          expectedRoles.size > 0 &&
          intersection(request.userRoles, expectedRoles).size === 0
        ) {
          throw new UnauthorizedError({
            message: "User does not have the privileges for this task.",
          });
        }
      } catch (err: unknown) {
        if (err instanceof BaseError) {
          throw err;
        }
        if (err instanceof jwt.TokenExpiredError) {
          throw new UnauthenticatedError({
            message: "Token has expired.",
          });
        }
        if (err instanceof Error) {
          request.log.error(`Failed to get user roles: ${err.toString()}`);
          throw err;
        }
        throw new UnauthenticatedError({
          message: "Invalid token.",
        });
      }
      request.log.info(`authenticated request from ${request.username} `);
      request.log.debug(
        `Start to authorization decision took ${new Date().getTime() - startTime} ms.`,
      );
      return request.userRoles;
    },
  );
};

const fastifyAuthPlugin = fp(authPlugin);
export default fastifyAuthPlugin;
