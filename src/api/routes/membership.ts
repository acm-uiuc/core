import { validateNetId } from "api/functions/validation.js";
import { FastifyPluginAsync } from "fastify";
import { ValidationError } from "zod-validation-error";

const membershipPlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.get<{
    Body: undefined;
    Querystring: { netId: string };
  }>("/:netId", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          netId: {
            type: "string",
          },
        },
      },
    },
  }, async (request, reply) => {
    const netId = (request.params as Record<string, string>).netId;
    if (!validateNetId(netId)) { // TODO: implement the validateNetId function
      throw new ValidationError(`${netId} is not a valid Illinois NetID!`);
    }
    // TODOs below:
    // 1. Check Dynamo table infra-core-api-membership-logs to see if `netid@illinois.edu` has an entry. if yes, return the json {netid: netid, isPaidMember: true}
    // 2. Call checkGroupMembership(token, `netid@acm.illinois.edu`, groupId). if yes, {netid: netid, isPaidMember: result}
    // 3. If AAD says they're a member, insert this yes result into infra-core-api-membership-logs so that it's cached for the next time.
    // request.log.debug(`Checking the group ID ${fastify.environmentConfig.PaidMemberGroupId} for membership`)
    reply.send(`Hello, ${netId}!`);
  });
};

export default membershipPlugin;
