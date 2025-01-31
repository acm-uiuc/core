import { FastifyRequest, FastifyInstance, FastifyReply } from "fastify";
import { AppRoles, RunEnvironment } from "../common/roles.js";
import { AadToken } from "./plugins/auth.js";
import { ConfigType } from "../common/config.js";
import NodeCache from "node-cache";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SESClient } from "@aws-sdk/client-ses";
import { SQSClient } from "@aws-sdk/client-sqs";
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
    sesClient: SESClient;
    sqsClient?: SQSClient;
    secretsManagerClient: SecretsManagerClient;
  }
  interface FastifyRequest {
    startTime: number;
    username?: string;
    tokenPayload?: AadToken;
  }
}
