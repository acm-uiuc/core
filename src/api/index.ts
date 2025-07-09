/* eslint import/no-nodejs-modules: ["error", {"allow": ["crypto", "path", "url"]}] */

import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import path from "path";
import fastify, { FastifyInstance } from "fastify";
import { RunEnvironment, runEnvironments } from "../common/roles.js";
import { InternalServerError } from "../common/errors/index.js";
import {
  environmentConfig,
  genericConfig,
  SecretConfig,
} from "../common/config.js";
import * as dotenv from "dotenv";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import NodeCache from "node-cache";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import {
  fastifyZodOpenApiPlugin,
  fastifyZodOpenApiTransform,
  fastifyZodOpenApiTransformObject,
  serializerCompiler,
  validatorCompiler,
} from "fastify-zod-openapi";
import { type ZodOpenApiVersion } from "zod-openapi";
import { withTags } from "./components/index.js";
import RedisModule from "ioredis";

/** BEGIN EXTERNAL PLUGINS */
import fastifyIp from "fastify-ip";
import cors from "@fastify/cors";
import FastifyAuthProvider from "@fastify/auth";
import fastifyStatic from "@fastify/static";
/** END EXTERNAL PLUGINS */

/** BEGIN INTERNAL PLUGINS */
import locationPlugin from "./plugins/location.js";
import fastifyAuthPlugin, { getSecretValue } from "./plugins/auth.js";
import errorHandlerPlugin from "./plugins/errorHandler.js";
import authorizeFromSchemaPlugin from "./plugins/authorizeFromSchema.js";
import evaluatePoliciesPlugin from "./plugins/evaluatePolicies.js";
/** END INTERNAL PLUGINS */

/** BEGIN ROUTES */
import organizationsPlugin from "./routes/organizations.js";
import icalPlugin from "./routes/ics.js";
import vendingPlugin from "./routes/vending.js";
import iamRoutes from "./routes/iam.js";
import ticketsPlugin from "./routes/tickets.js";
import linkryRoutes from "./routes/linkry.js";
import mobileWalletRoute from "./routes/mobileWallet.js";
import stripeRoutes from "./routes/stripe.js";
import membershipPlugin from "./routes/membership.js";
import roomRequestRoutes from "./routes/roomRequests.js";
import logsPlugin from "./routes/logs.js";
import apiKeyRoute from "./routes/apiKey.js";
import clearSessionRoute from "./routes/clearSession.js";
import protectedRoute from "./routes/protected.js";
import eventsPlugin from "./routes/events.js";
import sigleadRoutes from "./routes/siglead.js";
/** END ROUTES */

export const instanceId = randomUUID();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const now = () => Date.now();
const isRunningInLambda =
  process.env.LAMBDA_TASK_ROOT || process.env.AWS_LAMBDA_FUNCTION_NAME;

async function init(prettyPrint: boolean = false, initClients: boolean = true) {
  let isSwaggerServer = false;
  const transport = prettyPrint
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
          singleLine: false,
        },
      }
    : undefined;
  const app: FastifyInstance = fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
      transport,
    },
    disableRequestLogging: true,
    genReqId: (request) => {
      const header = request.headers["x-apigateway-event"];
      if (!header) {
        return randomUUID().toString();
      }
      const typeCheckedHeader = Array.isArray(header) ? header[0] : header;
      const event = JSON.parse(decodeURIComponent(typeCheckedHeader));
      return event.requestContext.requestId;
    },
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(authorizeFromSchemaPlugin);
  await app.register(fastifyAuthPlugin);
  await app.register(FastifyAuthProvider);
  await app.register(evaluatePoliciesPlugin);
  await app.register(errorHandlerPlugin);
  await app.register(fastifyZodOpenApiPlugin);
  await app.register(locationPlugin);
  if (!isRunningInLambda) {
    try {
      const fastifySwagger = import("@fastify/swagger");
      const fastifySwaggerUI = import("@fastify/swagger-ui");
      await app.register(fastifySwagger, {
        openapi: {
          info: {
            title: "ACM @ UIUC Core API",
            description: "ACM @ UIUC Core Management Platform",
            version: "1.0.0",
            contact: {
              name: "ACM @ UIUC Infrastructure Team",
              email: "infra@acm.illinois.edu",
              url: "infra.acm.illinois.edu",
            },
            license: {
              name: "BSD 3-Clause",
              identifier: "BSD-3-Clause",
              url: "https://github.com/acm-uiuc/core/blob/main/LICENSE",
            },
            termsOfService: "https://core.acm.illinois.edu/tos",
          },
          servers: [
            {
              url: "https://core.acm.illinois.edu",
              description: "Production API server",
            },
            {
              url: "https://core.aws.qa.acmuiuc.org",
              description: "QA API server",
            },
          ],

          tags: [
            {
              name: "Events",
              description:
                "Retrieve ACM @ UIUC-wide and organization-specific calendars and event metadata.",
            },
            {
              name: "Generic",
              description: "Retrieve metadata about a user or ACM @ UIUC .",
            },
            {
              name: "iCalendar Integration",
              description:
                "Retrieve Events calendars in iCalendar format (for integration with external calendar clients).",
            },
            {
              name: "IAM",
              description:
                "Identity and Access Management for internal services.",
            },
            { name: "Linkry", description: "Link Shortener." },
            {
              name: "Logging",
              description: "View audit logs for various services.",
            },
            {
              name: "Membership",
              description: "Purchasing or checking ACM @ UIUC membership.",
            },
            {
              name: "Tickets/Merchandise",
              description: "Handling the tickets and merchandise lifecycle.",
            },
            {
              name: "Mobile Wallet",
              description: "Issuing Apple/Google Wallet passes.",
            },
            {
              name: "Stripe",
              description:
                "Collecting payments for ACM @ UIUC invoices and other services.",
            },
            {
              name: "Room Requests",
              description:
                "Creating room reservation requests for ACM @ UIUC within University buildings.",
            },
            {
              name: "API Keys",
              description: "Manage the lifecycle of API keys.",
            },
          ],

          openapi: "3.1.0" satisfies ZodOpenApiVersion, // If this is not specified, it will default to 3.1.0
          components: {
            securitySchemes: {
              bearerAuth: {
                type: "http",
                scheme: "bearer",
                bearerFormat: "JWT",
                description:
                  "Authorization: Bearer {token}\n\nThis API uses JWT tokens issued by Entra ID (Azure AD) with the Core API audience. Tokens must be included in the Authorization header as a Bearer token for all protected endpoints.",
              },
              apiKeyAuth: {
                type: "apiKey",
                in: "header",
                name: "X-Api-Key",
              },
            },
          },
        },
        transform: fastifyZodOpenApiTransform,
        transformObject: fastifyZodOpenApiTransformObject,
      });
      await app.register(fastifySwaggerUI, {
        routePrefix: "/api/documentation",
      });
      isSwaggerServer = true;
    } catch (e) {
      app.log.warn("Fastify Swagger not created!");
    }
  }

  await app.register(fastifyStatic, {
    root: path.join(__dirname, "public"),
    prefix: "/",
  });
  if (!process.env.RunEnvironment) {
    process.env.RunEnvironment = "dev";
  }
  if (isRunningInLambda && !isSwaggerServer) {
    // Serve docs from S3
    app.get("/api/documentation", (_request, response) => {
      response.redirect("/docs/", 308);
    });
    app.get("/api/documentation/json", (_request, response) => {
      response.redirect("/docs/openapi.json", 308);
    });
    app.get("/api/documentation/yaml", (_request, response) => {
      response.redirect("/docs/openapi.yaml", 308);
    });
  }
  if (!runEnvironments.includes(process.env.RunEnvironment as RunEnvironment)) {
    throw new InternalServerError({
      message: `Invalid run environment ${app.runEnvironment}.`,
    });
  }
  if (process.env.DISABLE_AUDIT_LOG) {
    if (process.env.RunEnvironment !== "dev") {
      throw new InternalServerError({
        message: `Audit log can only be disabled if the run environment is "dev"!`,
      });
    }
    if (isRunningInLambda) {
      throw new InternalServerError({
        message: `Audit log cannot be disabled when running in AWS Lambda environment!`,
      });
    }
    app.log.warn(
      "Audit logging to Dynamo is disabled! Audit log statements will be logged to the console.",
    );
  }
  app.runEnvironment = process.env.RunEnvironment as RunEnvironment;
  app.environmentConfig =
    environmentConfig[app.runEnvironment as RunEnvironment];
  app.nodeCache = new NodeCache({ checkperiod: 30 });
  if (initClients) {
    app.dynamoClient = new DynamoDBClient({
      region: genericConfig.AwsRegion,
    });
    app.secretsManagerClient = new SecretsManagerClient({
      region: genericConfig.AwsRegion,
    });
    app.refreshSecretConfig = async () => {
      app.log.debug(
        `Getting secrets: ${JSON.stringify(app.environmentConfig.ConfigurationSecretIds)}.`,
      );
      const allSecrets = await Promise.all(
        app.environmentConfig.ConfigurationSecretIds.map((secretName) =>
          getSecretValue(app.secretsManagerClient, secretName),
        ),
      );
      app.secretConfig = allSecrets.reduce(
        (acc, currentSecret) => ({ ...acc, ...currentSecret }),
        {},
      ) as SecretConfig;
    };
    await app.refreshSecretConfig();
    app.redisClient = new RedisModule.default(app.secretConfig.redis_url);
  }
  if (isRunningInLambda) {
    await app.register(fastifyIp.default, {
      order: ["x-forwarded-for"],
      strict: true,
      isAWS: false,
    });
  }

  app.addHook("onRequest", (req, _, done) => {
    req.startTime = now();
    const hostname = req.hostname;
    const url = req.raw.url;
    req.log.info({ hostname, url, method: req.method }, "received request");
    done();
  });
  app.addHook("onResponse", (req, reply, done) => {
    req.log.info(
      {
        url: req.raw.url,
        statusCode: reply.raw.statusCode,
        durationMs: now() - req.startTime,
      },
      "request completed",
    );
    done();
  });
  app.get(
    "/api/v1/healthz",
    {
      schema: withTags(["Generic"], {
        summary: "Verify that the API server is healthy.",
      }),
    },
    async (_, reply) => {
      const startTime = new Date().getTime();
      await app.redisClient.ping();
      const redisTime = new Date().getTime();
      app.log.debug(`Redis latency: ${redisTime - startTime} ms.`);
      return reply.send({ message: "UP" });
    },
  );
  await app.register(
    async (api, _options) => {
      api.register(protectedRoute, { prefix: "/protected" });
      api.register(eventsPlugin, { prefix: "/events" });
      api.register(organizationsPlugin, { prefix: "/organizations" });
      api.register(membershipPlugin, { prefix: "/membership" });
      api.register(icalPlugin, { prefix: "/ical" });
      api.register(iamRoutes, { prefix: "/iam" });
      api.register(ticketsPlugin, { prefix: "/tickets" });
      api.register(linkryRoutes, { prefix: "/linkry" });
      api.register(mobileWalletRoute, { prefix: "/mobileWallet" });
      api.register(stripeRoutes, { prefix: "/stripe" });
      api.register(sigleadRoutes, { prefix: "/siglead" });
      api.register(roomRequestRoutes, { prefix: "/roomRequests" });
      api.register(logsPlugin, { prefix: "/logs" });
      api.register(apiKeyRoute, { prefix: "/apiKey" });
      api.register(clearSessionRoute, { prefix: "/clearSession" });
      if (app.runEnvironment === "dev") {
        api.register(vendingPlugin, { prefix: "/vending" });
      }
    },
    { prefix: "/api/v1" },
  );
  await app.register(cors, {
    origin: app.environmentConfig.ValidCorsOrigins,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE"],
  });

  app.addHook("onSend", async (request, reply) => {
    reply.header("X-Request-Id", request.id);
  });
  app.log.info("Initialized new Fastify instance...");
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`Logging level set to ${process.env.LOG_LEVEL || "info"}`);
  const client = new STSClient({ region: genericConfig.AwsRegion });
  const command = new GetCallerIdentityCommand({});
  try {
    const data = await client.send(command);
    console.log(`Logged in to AWS as ${data.Arn} on account ${data.Account}.`);
  } catch {
    console.error(
      `Could not get AWS STS credentials: are you logged in to AWS? Run "aws configure sso" to log in.`,
    );
    process.exit(1);
  }
  const app = await init(true);
  app.listen({ port: 8080 }, (err) => {
    /* eslint no-console: ["error", {"allow": ["log", "error"]}] */
    if (err) {
      console.error(err);
    }
  });
}
export default init;
