/* eslint import/no-nodejs-modules: ["error", {"allow": ["crypto"]}] */
import { randomUUID } from "crypto";
import fastify, { FastifyInstance } from "fastify";
import FastifyAuthProvider from "@fastify/auth";
import fastifyAuthPlugin from "./plugins/auth.js";
import protectedRoute from "./routes/protected.js";
import errorHandlerPlugin from "./plugins/errorHandler.js";
import { RunEnvironment, runEnvironments } from "../common/roles.js";
import { InternalServerError } from "../common/errors/index.js";
import eventsPlugin from "./routes/events.js";
import cors from "@fastify/cors";
import fastifyZodValidationPlugin from "./plugins/validate.js";
import { environmentConfig, genericConfig } from "../common/config.js";
import organizationsPlugin from "./routes/organizations.js";
import icalPlugin from "./routes/ics.js";
import vendingPlugin from "./routes/vending.js";
import * as dotenv from "dotenv";
import iamRoutes from "./routes/iam.js";
import ticketsPlugin from "./routes/tickets.js";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";

dotenv.config();

const now = () => Date.now();

async function init() {
  const app: FastifyInstance = fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info'
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
  await app.register(fastifyAuthPlugin);
  await app.register(fastifyZodValidationPlugin);
  await app.register(FastifyAuthProvider);
  await app.register(errorHandlerPlugin);
  if (!process.env.RunEnvironment) {
    process.env.RunEnvironment = "dev";
  }
  if (!runEnvironments.includes(process.env.RunEnvironment as RunEnvironment)) {
    throw new InternalServerError({
      message: `Invalid run environment ${app.runEnvironment}.`,
    });
  }
  app.runEnvironment = process.env.RunEnvironment as RunEnvironment;
  app.environmentConfig =
    environmentConfig[app.runEnvironment as RunEnvironment];
  app.addHook("onRequest", (req, _, done) => {
    req.startTime = now();
    req.log.info({ url: req.raw.url }, "received request");
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
  app.get("/api/v1/healthz", (_, reply) => reply.send({ message: "UP" }));
  await app.register(
    async (api, _options) => {
      api.register(protectedRoute, { prefix: "/protected" });
      api.register(eventsPlugin, { prefix: "/events" });
      api.register(organizationsPlugin, { prefix: "/organizations" });
      api.register(icalPlugin, { prefix: "/ical" });
      api.register(iamRoutes, { prefix: "/iam" });
      api.register(ticketsPlugin, { prefix: "/tickets" });
      if (app.runEnvironment === "dev") {
        api.register(vendingPlugin, { prefix: "/vending" });
      }
    },
    { prefix: "/api/v1" },
  );
  await app.register(cors, {
    origin: app.environmentConfig.ValidCorsOrigins,
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`Logging level set to ${process.env.LOG_LEVEL || 'info'}`);
  const client = new STSClient({ region: genericConfig.AwsRegion });
  const command = new GetCallerIdentityCommand({});
  try {
    const data = await client.send(command);
    console.log(`Logged in to AWS as ${data.Arn} on account ${data.Account}.`)
  } catch {
    console.error(`Could not get AWS STS credentials: are you logged in to AWS? Run "aws configure sso" to log in.`)
    process.exit(1);
  }
  const app = await init();
  app.listen({ port: 8080 }, async (err) => {
    /* eslint no-console: ["error", {"allow": ["log", "error"]}] */
    if (err) console.error(err);
  });
}
export default init;
