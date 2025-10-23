/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  type FastifyRequest,
  type FastifyInstance,
  type FastifyReply,
} from "fastify";
import { type AppRoles, type RunEnvironment } from "@common/roles.js";
import type NodeCache from "node-cache";
import { type DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { type SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { type SQSClient } from "@aws-sdk/client-sqs";
import { type AvailableAuthorizationPolicy } from "@common/policies/definition.js";

declare module "fastify" {
  interface FastifyRequest {
    startTime: number;
    username?: string;
    userRoles?: Set<AppRoles>;
    tokenPayload?: AadToken;
    policyRestrictions?: AvailableAuthorizationPolicy[];
  }
}

export type NoDataRequest = {
  Params: undefined;
  Querystring: undefined;
  Body: undefined;
};
