import "zod-openapi/extend";
import awsLambdaFastify, { LambdaResponse } from "@fastify/aws-lambda";
import init from "./index.js";
import warmer from "lambda-warmer";
import { type APIGatewayEvent, type Context } from "aws-lambda";
import { InternalServerError, ValidationError } from "common/errors/index.js";
import { promisify } from "node:util";
import stream from "node:stream";

const pipeline = promisify(stream.pipeline);
const app = await init();
const realHandler = awsLambdaFastify(app, {
  decorateRequest: false,
  serializeLambdaArguments: true,
  callbackWaitsForEmptyEventLoop: false,
  payloadAsStream: true,
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
  }
  awslambda.streamifyResponse(async (event, responseStream, context) => {
    const { meta, stream } = await realHandler(event, context);
    responseStream = awslambda.HttpResponseStream.from(
      responseStream,
      meta as unknown as Record<string, unknown>,
    ); // weird typing bug
    await pipeline(stream, responseStream);
  });
};

await app.ready(); // needs to be placed after awsLambdaFastify call because of the decoration: https://github.com/fastify/aws-lambda-fastify/blob/master/index.js#L9
export { handler };
