/* eslint-disable */

import "zod-openapi/extend";
import awsLambdaFastify from "@fastify/aws-lambda";
import init from "./index.js";
import {
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider,
} from "fastify-type-provider-zod";

const app = await init();
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);
const handler = awsLambdaFastify(app, {
  decorateRequest: false,
  serializeLambdaArguments: true,
});
await app.ready(); // needs to be placed after awsLambdaFastify call because of the decoration: https://github.com/fastify/aws-lambda-fastify/blob/master/index.js#L9
export { handler };
