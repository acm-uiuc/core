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

/** BEGIN EXTERNAL PLUGINS */
import fastifyIp from "fastify-ip";
import cors from "@fastify/cors";
import FastifyAuthProvider from "@fastify/auth";
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
import rsvpRoutes from "./routes/rsvp.js";
import mobileWalletV2Route from "./routes/v2/mobileWallet.js";
import membershipV2Plugin from "./routes/v2/membership.js";
import { docsHtml, securitySchemes } from "./docs.js";
import syncIdentityPlugin from "./routes/syncIdentity.js";
import { createRedisModule } from "./redis.js";
import userRoute from "./routes/user.js";
import { getSsmParameter } from "./utils.js";
import { SSMClient } from "@aws-sdk/client-ssm";
import validateTurnstileTokenPlugin from "./plugins/validateTurnstile.js";
/** END ROUTES */

export const instanceId = randomUUID();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const now = () => Date.now();
const isRunningInLambda =
  process.env.LAMBDA_TASK_ROOT || process.env.AWS_LAMBDA_FUNCTION_NAME;

async function init(
  prettyPrint: boolean = false,
  initClients: boolean = true,
  forceSwagger: boolean = false,
) {
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
    routerOptions: {
      ignoreTrailingSlash: true,
      ignoreDuplicateSlashes: true,
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
  if (!process.env.RunEnvironment) {
    process.env.RunEnvironment = "dev";
  }
  app.runEnvironment = process.env.RunEnvironment as RunEnvironment;
  app.environmentConfig =
    environmentConfig[app.runEnvironment as RunEnvironment];
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  if (!isRunningInLambda || forceSwagger) {
    try {
      const { default: fastifySwagger } = await import("@fastify/swagger");
      await app.register(fastifySwagger, {
        openapi: {
          info: {
            title: "ACM @ UIUC Core API",
            description: `
The ACM @ UIUC Core API provides services for managing chapter operations.

## Usage

The primary consumer of the Core API is the Management Portal, which allows members to manage the chapter.
Others may call the API with an API key; please contact us to obtain one.

This API also integrates into the ACM website and other suborganization to provide calendar services.

Calendar clients call the iCal endpoints (available through [ical.acm.illinois.edu](https://ical.acm.illinois.edu)) for calendar services.

## Contact
<hr />

If you are an ACM @ UIUC member, please join the Infra Committee Discord for support.
Otherwise, email [infra@acm.illinois.edu](mailto:infra@acm.illinois.edu) for support.

**For all security concerns, please email [infra@acm.illinois.edu](mailto:infra@acm.illinois.edu) with the subject "Security Concern".**
`,
            version: "2.0.1",
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
              url: app.environmentConfig.UserFacingUrl,
              description: "Main API server",
            },
          ],

          tags: [
            {
              name: "Events",
              description:
                "Retrieve ACM @ UIUC-wide and organization-specific calendars and event metadata.",
            },
            {
              name: "RSVP",
              description:
                "RSVP to events and manage your RSVPs for ACM @ UIUC events.",
            },
            {
              name: "Generic",
              description: "Retrieve metadata about a user or ACM @ UIUC.",
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
            securitySchemes: securitySchemes as any,
          },
        },
        transform: fastifyZodOpenApiTransform,
        transformObject: fastifyZodOpenApiTransformObject,
      });
      app.get("/docs", { schema: { hide: true } }, (_request, reply) => {
        reply.type("text/html").send(docsHtml);
      });
      app.get(
        "/docs/openapi.json",
        { schema: { hide: true } },
        (_request, reply) => {
          reply.send(app.swagger());
        },
      );
      app.get(
        "/docs/openapi.yml",
        { schema: { hide: true } },
        (_request, reply) => {
          reply.send(app.swagger({ yaml: true }));
        },
      );
      isSwaggerServer = true;
    } catch (e) {
      app.log.error(e);
      app.log.warn("Fastify Swagger not created!");
    }
  }
  await Promise.all([
    app.register(errorHandlerPlugin),
    app.register(fastifyZodOpenApiPlugin),
    app.register(locationPlugin),
    app.register(validateTurnstileTokenPlugin),
  ]);

  await app.register(fastifyAuthPlugin);
  await app.register(FastifyAuthProvider);
  await app.register(authorizeFromSchemaPlugin);

  await app.register(evaluatePoliciesPlugin);
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
      app.log.debug(
        `Getting secure parameters (SSM): ${JSON.stringify(app.environmentConfig.ConfigurationParameterIds)}.`,
      );
      const ssmClient = new SSMClient({ region: genericConfig.AwsRegion });
      const allParameters = await Promise.all(
        app.environmentConfig.ConfigurationParameterIds.map(
          async (parameterName) => {
            const val = await getSsmParameter({
              parameterName,
              logger: app.log,
              ssmClient,
            });
            const key = parameterName.split("/").at(-1) || parameterName;
            return { [key]: val };
          },
        ),
      );
      const allConfig = [...allSecrets, ...allParameters];
      app.secretConfig = allConfig.reduce(
        (acc, currentSecret) => ({ ...acc, ...currentSecret }),
        {},
      ) as SecretConfig;
    };
    await app.refreshSecretConfig();
    app.redisClient = await createRedisModule(
      app.secretConfig.redis_url,
      app.secretConfig.fallback_redis_url,
      app.log,
    );
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
  app.addHook("preHandler", app.validateTurnstileToken);
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
      api.register(syncIdentityPlugin, { prefix: "/syncIdentity" });
      api.register(protectedRoute, { prefix: "/protected" });
      api.register(eventsPlugin, { prefix: "/events" });
      api.register(rsvpRoutes, { prefix: "/rsvp" });
      api.register(organizationsPlugin, { prefix: "/organizations" });
      api.register(membershipPlugin, { prefix: "/membership" });
      api.register(icalPlugin, { prefix: "/ical" });
      api.register(iamRoutes, { prefix: "/iam" });
      api.register(ticketsPlugin, { prefix: "/tickets" });
      api.register(linkryRoutes, { prefix: "/linkry" });
      api.register(mobileWalletRoute, { prefix: "/mobileWallet" });
      api.register(stripeRoutes, { prefix: "/stripe" });
      api.register(roomRequestRoutes, { prefix: "/roomRequests" });
      api.register(logsPlugin, { prefix: "/logs" });
      api.register(apiKeyRoute, { prefix: "/apiKey" });
      api.register(clearSessionRoute, { prefix: "/clearSession" });
      api.register(userRoute, { prefix: "/users" });
      if (app.runEnvironment === "dev") {
        api.register(vendingPlugin, { prefix: "/vending" });
      }
    },
    { prefix: "/api/v1" },
  );
  await app.register(
    async (api, _options) => {
      api.register(mobileWalletV2Route, { prefix: "/mobileWallet" });
      api.register(membershipV2Plugin, { prefix: "/membership" });
    },
    { prefix: "/api/v2" },
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

export default init;
