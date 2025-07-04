import "zod-openapi/extend";
import awsLambdaFastify, { LambdaResponse } from "@fastify/aws-lambda";
import init from "./index.js";
import warmer from "lambda-warmer";
import { type APIGatewayEvent, type Context } from "aws-lambda";
import { InternalServerError, ValidationError } from "common/errors/index.js";

const app = await init();
const realHandler = awsLambdaFastify(app, {
  decorateRequest: false,
  serializeLambdaArguments: true,
  callbackWaitsForEmptyEventLoop: false,
});
const handler = async (event: APIGatewayEvent, context: Context) => {
  // if a warming event
  if (await warmer(event, { correlationId: context.awsRequestId }, context)) {
    return "warmed";
  }
  if (process.env.ORIGIN_VERIFY_KEY) {
    // check that the request has the right header (coming from cloudfront)
    if (
      !event.headers ||
      !(event.headers["X-Origin-Verify"] === process.env.ORIGIN_VERIFY_KEY)
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
