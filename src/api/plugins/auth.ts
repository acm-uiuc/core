import { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import jwksClient from "jwks-rsa";
import jwt, { Algorithm } from "jsonwebtoken";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { AppRoles } from "../../common/roles.js";
import {
  BaseError,
  InternalServerError,
  UnauthenticatedError,
  UnauthorizedError,
} from "../../common/errors/index.js";
import { genericConfig, SecretConfig } from "../../common/config.js";
import { getGroupRoles, getUserRoles } from "../functions/authorization.js";
import {
  GetItemCommand,
  ReplicaAlreadyExistsException,
} from "@aws-sdk/client-dynamodb";
import { getApiKeyData, getApiKeyParts } from "api/functions/apiKey.js";
import { RequestThrottled } from "@aws-sdk/client-sqs";

export function intersection<T>(setA: Set<T>, setB: Set<T>): Set<T> {
  const _intersection = new Set<T>();
  for (const elem of setB) {
    if (setA.has(elem)) {
      _intersection.add(elem);
    }
  }
  return _intersection;
}

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

const authPlugin: FastifyPluginAsync = async (fastify, _options) => {
  const handleApiKeyAuthentication = async (
    request: FastifyRequest,
    _reply: FastifyReply,
    validRoles: AppRoles[],
  ): Promise<Set<AppRoles>> => {
    const apiKeyValueTemp = request.headers["X-Api-Key"];
    if (!apiKeyValueTemp) {
      throw new UnauthenticatedError({
        message: "API key not found.",
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
        message: "API key not found.",
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
    return new Set(keyData.roles);
  };
  fastify.decorate(
    "authorize",
    async function (
      request: FastifyRequest,
      reply: FastifyReply,
      validRoles: AppRoles[],
      apiKeyAuthEnabled: boolean = true,
    ): Promise<Set<AppRoles>> {
      const userRoles = new Set([] as AppRoles[]);
      try {
        const apiKeyHeader = request.headers
          ? request.headers["X-Api-Key"]
          : null;
        if (apiKeyHeader) {
          if (apiKeyAuthEnabled) {
            return handleApiKeyAuthentication(request, reply, validRoles);
          } else {
            throw new UnauthenticatedError({
              message:
                "API key authentication is not permitted for this resource.",
            });
          }
        }
        const authHeader = request.headers
          ? request.headers["authorization"]
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
            ((
              (await getSecretValue(
                fastify.secretsManagerClient,
                genericConfig.ConfigSecretName,
              )) || {
                jwt_key: "",
              }
            ).jwt_key as string) ||
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
          const client = jwksClient({
            jwksUri: "https://login.microsoftonline.com/common/discovery/keys",
          });
          signingKey = (await client.getSigningKey(header.kid)).getPublicKey();
        }

        const verifiedTokenData = jwt.verify(
          token,
          signingKey,
          verifyOptions,
        ) as AadToken;
        request.tokenPayload = verifiedTokenData;
        request.username =
          verifiedTokenData.email ||
          verifiedTokenData.upn?.replace("acm.illinois.edu", "illinois.edu") ||
          verifiedTokenData.sub;
        const expectedRoles = new Set(validRoles);
        if (verifiedTokenData.groups) {
          const groupRoles = await Promise.allSettled(
            verifiedTokenData.groups.map((x) =>
              getGroupRoles(fastify.dynamoClient, fastify, x),
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
        } else {
          if (
            verifiedTokenData.roles &&
            fastify.environmentConfig.AzureRoleMapping
          ) {
            for (const group of verifiedTokenData.roles) {
              if (fastify.environmentConfig["AzureRoleMapping"][group]) {
                for (const role of fastify.environmentConfig[
                  "AzureRoleMapping"
                ][group]) {
                  userRoles.add(role);
                }
              }
            }
          }
        }

        // add user-specific role overrides
        if (request.username) {
          try {
            const userAuth = await getUserRoles(
              fastify.dynamoClient,
              fastify,
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
        if (
          expectedRoles.size > 0 &&
          intersection(userRoles, expectedRoles).size === 0
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
          request.log.error(`Failed to verify JWT: ${err.toString()} `);
          throw err;
        }
        throw new UnauthenticatedError({
          message: "Invalid token.",
        });
      }
      request.log.info(`authenticated request from ${request.username} `);
      request.userRoles = userRoles;
      return userRoles;
    },
  );
};

const fastifyAuthPlugin = fp(authPlugin);
export default fastifyAuthPlugin;
