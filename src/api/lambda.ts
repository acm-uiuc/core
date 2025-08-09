import awsLambdaFastify from "@fastify/aws-lambda";
import init, { instanceId } from "./index.js";
import { type APIGatewayEvent, type Context } from "aws-lambda";
import { InternalServerError, ValidationError } from "common/errors/index.js";

const app = await init();
const realHandler = awsLambdaFastify(app, {
  decorateRequest: false,
  serializeLambdaArguments: true,
  callbackWaitsForEmptyEventLoop: false,
  binaryMimeTypes: ["application/octet-stream", "application/vnd.apple.pkpass"],
});

type WarmerEvent = { action: "warmer" };

/**
 * Validates the origin verification header against the current and previous keys.
 * @returns {boolean} `true` if the request is valid, otherwise `false`.
 */
const validateOriginHeader = (
  originHeader: string | undefined,
  currentKey: string,
  previousKey: string | undefined,
  previousKeyExpiresAt: string | undefined,
): boolean => {
  // 1. A header must exist to be valid.
  if (!originHeader) {
    return false;
  }

  // 2. Check against the current key first for an early return on the happy path.
  if (originHeader === currentKey) {
    return true;
  }

  // 3. If it's not the current key, check the previous key during the rotation window.
  if (previousKey && previousKeyExpiresAt) {
    const isExpired = new Date() >= new Date(previousKeyExpiresAt);
    if (originHeader === previousKey && !isExpired) {
      return true;
    }
  }

  // 4. If all checks fail, the header is invalid.
  return false;
};

const handler = async (
  event: APIGatewayEvent | WarmerEvent,
  context: Context,
) => {
  if ("action" in event && event.action === "warmer") {
    return { instanceId };
  }
  event = event as APIGatewayEvent;

  const currentKey = process.env.ORIGIN_VERIFY_KEY;
  const previousKey = process.env.PREVIOUS_ORIGIN_VERIFY_KEY;
  const previousKeyExpiresAt =
    process.env.PREVIOUS_ORIGIN_VERIFY_KEY_EXPIRES_AT;

  // Log an error if the previous key has expired but is still configured.
  if (previousKey && previousKeyExpiresAt) {
    if (new Date() >= new Date(previousKeyExpiresAt)) {
      console.error(
        "Expired previous origin verify key is still present in the environment. Expired at:",
        previousKeyExpiresAt,
      );
    }
  }

  // Proceed with verification only if a current key is set.
  if (currentKey) {
    const isValid = validateOriginHeader(
      event.headers?.["x-origin-verify"],
      currentKey,
      previousKey,
      previousKeyExpiresAt,
    );

    if (!isValid) {
      const newError = new ValidationError({
        message: "Request is not valid.",
      });
      const json = JSON.stringify(newError.toJson());
      return {
        statusCode: newError.httpStatusCode,
        body: json,
        headers: {
          "Content-Type": "application/json",
        },
        isBase64Encoded: false,
      };
    }

    delete event.headers["x-origin-verify"];
  }

  // If verification is disabled or passed, proceed with the real handler logic.
  return await realHandler(event, context).catch((e) => {
    console.error(e);
    const newError = new InternalServerError({
      message: "Failed to initialize application.",
    });
    const json = JSON.stringify(newError.toJson());
    return {
      statusCode: newError.httpStatusCode,
      body: json,
      headers: {
        "Content-Type": "application/json",
      },
      isBase64Encoded: false,
    };
  });
};

await app.ready();
export { handler };
