/* eslint-disable */

import "zod-openapi/extend";
import awsLambdaFastify from "@fastify/aws-lambda";
import init from "./index.js";

const app = await init();
const handler = awsLambdaFastify(app, {
  decorateRequest: false,
  serializeLambdaArguments: true,
});
await app.ready(); // needs to be placed after awsLambdaFastify call because of the decoration: https://github.com/fastify/aws-lambda-fastify/blob/master/index.js#L9
export { handler };
