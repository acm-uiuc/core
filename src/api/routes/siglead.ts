import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { allAppRoles, AppRoles } from "../../common/roles.js";
import {
  addToTenant,
  getEntraIdToken,
  listGroupMembers,
  modifyGroup,
  patchUserProfile,
} from "../functions/entraId.js";
import {
  BaseError,
  DatabaseFetchError,
  DatabaseInsertError,
  EntraGroupError,
  EntraInvitationError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from "../../common/errors/index.js";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { genericConfig } from "../../common/config.js";
import { marshall } from "@aws-sdk/util-dynamodb";
import {
  InviteUserPostRequest,
  invitePostRequestSchema,
  GroupMappingCreatePostRequest,
  groupMappingCreatePostSchema,
  entraActionResponseSchema,
  groupModificationPatchSchema,
  GroupModificationPatchRequest,
  EntraGroupActions,
  entraGroupMembershipListResponse,
  ProfilePatchRequest,
  entraProfilePatchRequest,
} from "../../common/types/iam.js";
import {
  AUTH_DECISION_CACHE_SECONDS,
  getGroupRoles,
} from "../functions/authorization.js";
import { OrganizationList } from "common/orgs.js";
import { z } from "zod";

const OrganizationListEnum = z.enum(OrganizationList as [string, ...string[]]);
export type Org = z.infer<typeof OrganizationListEnum>;

type Member = { name: string; email: string };
type OrgMembersResponse = { org: Org; members: Member[] };

const sigleadRoutes: FastifyPluginAsync = async (fastify, _options) => {
  fastify.get<{
    Reply: OrgMembersResponse[];
  }>("/groups", async (request, reply) => {
    const entraIdToken = await getEntraIdToken(
      {
        smClient: fastify.secretsManagerClient,
        dynamoClient: fastify.dynamoClient,
      },
      fastify.environmentConfig.AadValidClientId,
    );

    const data = await Promise.all(
      OrganizationList.map(async (org) => {
        const members: Member[] = await listGroupMembers(entraIdToken, org);
        return { org, members } as OrgMembersResponse;
      }),
    );

    reply.status(200).send(data);
  });
};

export default sigleadRoutes;
