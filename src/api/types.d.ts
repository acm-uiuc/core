/* eslint-disable @typescript-eslint/no-unused-vars */
import { FastifyRequest, FastifyInstance, FastifyReply } from "fastify";
import { AppRoles, RunEnvironment } from "../common/roles.js";
import { AadToken } from "./plugins/auth.js";
import { ConfigType } from "../common/config.js";
import NodeCache from "node-cache";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SQSClient } from "@aws-sdk/client-sqs";
import { CloudFrontKeyValueStoreClient } from "@aws-sdk/client-cloudfront-keyvaluestore";

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
    ) => Promise<Set<AppRoles>>;
    zodValidateBody: (
      request: FastifyRequest,
      _reply: FastifyReply,
      zodSchema: Zod.ZodTypeAny,
    ) => Promise<void>;
    runEnvironment: RunEnvironment;
    environmentConfig: ConfigType;
    nodeCache: NodeCache;
    dynamoClient: DynamoDBClient;
    sqsClient?: SQSClient;
    secretsManagerClient: SecretsManagerClient;
    cloudfrontKvClient: CloudFrontKeyValueStoreClient;
  }
  interface FastifyRequest {
    startTime: number;
    username?: string;
    userRoles?: Set<AppRoles>;
    tokenPayload?: AadToken;
  }
}

export type NoDataRequest = {
  Params: undefined;
  Querystring: undefined;
  Body: undefined;
};
