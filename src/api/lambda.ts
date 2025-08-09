import awsLambdaFastify from "@fastify/aws-lambda";
import { pipeline } from "node:stream/promises";
import init, { instanceId } from "./index.js";
import { InternalServerError, ValidationError } from "common/errors/index.js";

// Initialize the proxy with the payloadAsStream option
const app = await init();
const proxy = awsLambdaFastify(app, {
  payloadAsStream: true,
  decorateRequest: false,
  callbackWaitsForEmptyEventLoop: false,
  serializeLambdaArguments: true,
  binaryMimeTypes: ["application/octet-stream", "application/vnd.apple.pkpass"], // from original code
});

const validateOriginHeader = (
  originHeader: string,
  currentKey: string,
  previousKey: string | undefined,
  previousKeyExpiresAt: string | undefined,
) => {
  if (!originHeader) {
    return false;
  }
  if (originHeader === currentKey) {
    return true;
  }
  if (previousKey && previousKeyExpiresAt) {
    const isExpired = new Date() >= new Date(previousKeyExpiresAt);
    if (originHeader === previousKey && !isExpired) {
      return true;
    }
  }
  return false;
};

// This handler now correctly uses the native streaming support from the packages.
export const handler = awslambda.streamifyResponse(
  async (event: any, responseStream: any, context: any) => {
    // 1. Handle warmer events
    if ("action" in event && event.action === "warmer") {
      responseStream.write(JSON.stringify({ instanceId }));
      responseStream.end();
      return;
    }

    // 2. Perform origin header validation before calling the proxy
    const currentKey = process.env.ORIGIN_VERIFY_KEY;
    if (currentKey) {
      const previousKey = process.env.PREVIOUS_ORIGIN_VERIFY_KEY;
      const previousKeyExpiresAt =
        process.env.PREVIOUS_ORIGIN_VERIFY_KEY_EXPIRES_AT;

      const isValid = validateOriginHeader(
        event.headers?.["x-origin-verify"],
        currentKey,
        previousKey,
        previousKeyExpiresAt,
      );

      if (!isValid) {
        const error = new ValidationError({ message: "Request is not valid." });
        const body = JSON.stringify(error.toJson());

        // On validation failure, manually create the response
        const meta = {
          statusCode: error.httpStatusCode,
          headers: { "Content-Type": "application/json" },
        };
        const httpStream = awslambda.HttpResponseStream.from(
          responseStream,
          meta,
        );
        httpStream.write(body);
        httpStream.end();
        return;
      }
      delete event.headers["x-origin-verify"];
    }

    // 3. If validation passes, proxy the request and stream the response
    try {
      const { stream, meta } = await proxy(event, context);
      responseStream = awslambda.HttpResponseStream.from(
        responseStream,
        meta as any,
      );
      await pipeline(stream, responseStream);
    } catch (e) {
      console.error("Error during proxy or stream pipeline:", e);
      const error = new InternalServerError({
        message: "Failed to process request.",
      });
      const body = JSON.stringify(error.toJson());
      const meta = {
        statusCode: error.httpStatusCode,
        headers: { "Content-Type": "application/json" },
      };
      const httpStream = awslambda.HttpResponseStream.from(
        responseStream,
        meta,
      );
      httpStream.write(body);
      httpStream.end();
    }
  },
);
