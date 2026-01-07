/* eslint-disable @typescript-eslint/no-unused-vars */
import { FastifyRequest, FastifyInstance, FastifyReply } from "fastify";
import { AppRoles, RunEnvironment } from "../common/roles.js";
import { AadToken } from "./plugins/auth.js";
import { ConfigType, SecretConfig, SecretTesting } from "../common/config.js";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SQSClient } from "@aws-sdk/client-sqs";
import { AvailableAuthorizationPolicy } from "common/policies/definition.js";
import type RedisModule from "ioredis";
import { type S3Client } from "@aws-sdk/client-s3";
export type Redis = RedisModule.default;
export type ValidLoggers = FastifyBaseLogger | pino.Logger;

interface CloudfrontLocation {
  country: string | undefined;
  city: string | undefined;
  region: string | undefined;
  latitude: string | undefined;
  longitude: string | undefined;
  postalCode: string | undefined;
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    authorize: (
      request: FastifyRequest,
      reply: FastifyReply,
      validRoles: AppRoles[],
      disableApiKeyAuth: boolean,
    ) => Promise<Set<AppRoles>>;
    authorizeFromSchema: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    runEnvironment: RunEnvironment;
    environmentConfig: ConfigType;
    dynamoClient: DynamoDBClient;
    sqsClient?: SQSClient;
    s3Client?: S3Client;
    redisClient: Redis;
    secretsManagerClient: SecretsManagerClient;
    secretConfig: SecretConfig | (SecretConfig & SecretTesting);
    refreshSecretConfig: CallableFunction;
  }
  interface FastifyRequest {
    startTime: number;
    username?: string;
    userRoles?: Set<AppRoles>;
    tokenPayload?: AadToken;
    policyRestrictions?: AvailableAuthorizationPolicy[];
    location: CloudfrontLocation;
  }
}

export type NoDataRequest = {
  Params: undefined;
  Querystring: undefined;
  Body: undefined;
};

export interface AuthenticatedRequest extends FastifyRequest {
  username: string;
  userRoles: Set<AppRoles>;
}
