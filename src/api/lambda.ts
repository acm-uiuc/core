import awsLambdaFastify from "@fastify/aws-lambda";
import init, { instanceId } from "./server.js";
import { ValidationError } from "common/errors/index.js";
import { Readable } from "node:stream";
import middy, { executionModeStreamifyResponse } from "@middy/core";

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

const lambdaHandler = async (event: any, context: any) => {
  context.callbackWaitsForEmptyEventLoop = false;

  // 1. Handle warmer action
  if ("action" in event && event.action === "warmer") {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: Readable.from(Buffer.from(JSON.stringify({ instanceId }))),
    };
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

      return {
        statusCode: error.httpStatusCode,
        headers: { "Content-Type": "application/json" },
        body: Readable.from(Buffer.from(body)),
      };
    }
    delete event.headers["x-origin-verify"];
  }

  // 3. Call the proxy and return the streaming response
  const { stream, meta } = await proxy(event, context);

  // Fix issue with Lambda where streaming responses always require a body to be present
  const body =
    stream.readableLength > 0 ? stream : Readable.from(Buffer.from(" "));

  return {
    statusCode: meta.statusCode,
    headers: meta.headers,
    body,
  };
};

export const handler = middy({
  executionMode: executionModeStreamifyResponse,
}).handler(lambdaHandler);
