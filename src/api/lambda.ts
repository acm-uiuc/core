import awsLambdaFastify from "@fastify/aws-lambda";
import init, { instanceId } from "./index.js";
import { type APIGatewayEvent, type Context } from "aws-lambda";
import { InternalServerError, ValidationError } from "common/errors/index.js";

const app = await init();
const realHandler = awsLambdaFastify(app, {
  decorateRequest: false,
  serializeLambdaArguments: true,
  callbackWaitsForEmptyEventLoop: false,
});
type WarmerEvent = { action: "warmer" };
const handler = async (
  event: APIGatewayEvent | WarmerEvent,
  context: Context,
) => {
  if ("action" in event && event.action === "warmer") {
    return { instanceId };
  }
  event = event as APIGatewayEvent;
  if (process.env.ORIGIN_VERIFY_KEY) {
    // check that the request has the right header (coming from cloudfront)
    if (
      !event.headers ||
      !(event.headers["x-origin-verify"] === process.env.ORIGIN_VERIFY_KEY)
    ) {
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
  // else proceed with handler logic
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

await app.ready(); // needs to be placed after awsLambdaFastify call because of the decoration: https://github.com/fastify/aws-lambda-fastify/blob/master/index.js#L9
export { handler };
