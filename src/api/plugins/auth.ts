import {
  FastifyBaseLogger,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import fp from "fastify-plugin";
import jwksClient from "jwks-rsa";
import jwt, { Algorithm } from "jsonwebtoken";
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
import { SecretConfig, GENERIC_CACHE_SECONDS } from "../../common/config.js";
import { getGroupRoles, getUserRoles } from "../functions/authorization.js";
import {
  getApiKeyData,
  getApiKeyParts,
  verifyApiKey,
} from "api/functions/apiKey.js";
import { getKey, setKey } from "api/functions/redisCache.js";
import { Redis } from "api/types.js";
import { AUTH_CACHE_PREFIX } from "common/constants.js";

const { JsonWebTokenError } = jwt;

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
    if (e instanceof BaseError) {
      throw e;
    }
    request.log.error(e, "Failed to determine user identifier");
    return null;
  }
};

export const getJwksKey = async ({
  redisClient,
  kid,
  logger,
}: {
  redisClient: Redis;
  kid: string;
  logger: FastifyBaseLogger;
}) => {
  let signingKey;
  const cachedJwksSigningKey = await getKey<{ key: string }>({
    redisClient,
    key: `jwksKey:${kid}`,
    logger,
  });
  if (cachedJwksSigningKey) {
    signingKey = cachedJwksSigningKey.key;
    logger.debug("Got JWKS signing key from cache.");
  } else {
    const client = jwksClient({
      jwksUri: "https://login.microsoftonline.com/common/discovery/keys",
    });
    signingKey = (await client.getSigningKey(kid)).getPublicKey();
    await setKey({
      redisClient,
      key: `jwksKey:${kid}`,
      data: JSON.stringify({ key: signingKey }),
      expiresIn: JWKS_CACHE_SECONDS,
      logger,
    });
    logger.debug("Got JWKS signing key from server.");
  }
  return signingKey;
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
    const apiKeyDecomp = getApiKeyParts(apiKeyValue);
    const keyData = await getApiKeyData({
      redisClient: fastify.redisClient,
      dynamoClient: fastify.dynamoClient,
      id: apiKeyDecomp.id,
    });
    if (!keyData) {
      throw new UnauthenticatedError({
        message: "Invalid API key.",
      });
    }
    const isValid = await verifyApiKey({
      apiKey: apiKeyDecomp,
      hashedKey: keyData.keyHash,
      redisClient: fastify.redisClient,
    });
    if (!isValid) {
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
    request.username = `acmuiuc_${apiKeyDecomp.id}`;
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
            ((fastify.secretConfig as SecretConfig).jwt_key as string) ||
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
          const { redisClient } = fastify;
          signingKey = await getJwksKey({
            redisClient,
            kid: header.kid,
            logger: request.log,
          });
        }

        const verifiedTokenData = jwt.verify(
          token,
          signingKey,
          verifyOptions,
        ) as AadToken;
        request.log.debug(
          `Start to verifying JWT took ${new Date().getTime() - startTime} ms.`,
        );
        // check revocation list for token
        const proposedUsername =
          verifiedTokenData.email ||
          verifiedTokenData.upn?.replace("acm.illinois.edu", "illinois.edu") ||
          verifiedTokenData.sub;
        const { redisClient, log: logger } = fastify;
        const revokedResult = await getKey<{ isInvalid: boolean }>({
          redisClient,
          key: `tokenRevocationList:${verifiedTokenData.uti}`,
          logger,
        });
        if (revokedResult) {
          fastify.log.info(
            `Revoked token ${verifiedTokenData.uti} for ${proposedUsername} was attempted.`,
          );
          throw new UnauthenticatedError({
            message: "Invalid token.",
          });
        }
        request.tokenPayload = verifiedTokenData;
        request.username = proposedUsername;
        const expectedRoles = new Set(validRoles);
        const cachedRoles = await getKey<string[]>({
          key: `${AUTH_CACHE_PREFIX}${request.username}:roles`,
          redisClient,
          logger: request.log,
        });
        if (cachedRoles) {
          request.userRoles = new Set(cachedRoles as AppRoles[]);
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
                request.log,
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
          setKey({
            key: `${AUTH_CACHE_PREFIX}${request.username}:roles`,
            data: JSON.stringify([...userRoles]),
            redisClient,
            expiresIn: GENERIC_CACHE_SECONDS,
            logger: request.log,
          });
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
        if (err instanceof JsonWebTokenError) {
          request.log.error(err, "JSON Web token error");
          throw new UnauthenticatedError({
            message: "Invalid token.",
          });
        }
        if (err instanceof Error) {
          request.log.error(`Failed to get user roles: ${err.toString()}`);
          throw err;
        }
        request.log.error(err, "Unknown auth error");
        throw new UnauthenticatedError({
          message: "Invalid token.",
        });
      }
      request.log = request.log.child({ user: request.username });
      request.log.debug(
        `Start to authorization decision took ${new Date().getTime() - startTime} ms.`,
      );
      return request.userRoles;
    },
  );
};

const fastifyAuthPlugin = fp(authPlugin);
export default fastifyAuthPlugin;
