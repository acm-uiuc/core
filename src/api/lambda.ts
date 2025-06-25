import "zod-openapi/extend";
import awsLambdaFastify from "@fastify/aws-lambda";
import init from "./index.js";
import warmer from "lambda-warmer";
import { type APIGatewayEvent, type Context } from "aws-lambda";

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
  // else proceed with handler logic
  return realHandler(event, context);
};

await app.ready(); // needs to be placed after awsLambdaFastify call because of the decoration: https://github.com/fastify/aws-lambda-fastify/blob/master/index.js#L9
export { handler };
