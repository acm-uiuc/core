import { OrganizationList } from "../orgs.js";
import { AppRoles } from "../roles.js";
import { z } from "zod";

export enum EntraGroupActions {
  ADD,
  REMOVE,
}

export interface EntraInvitationResponse {
  status: number;
  data?: Record<string, string>;
  error?: {
    message: string;
    code?: string;
  };
}

export const invitePostRequestSchema = z.object({
  emails: z.array(z.string()),
});

export type InviteUserPostRequest = z.infer<typeof invitePostRequestSchema>;

export const groupMappingCreatePostSchema = z.object({
  roles: z.union([
    z
      .array(z.nativeEnum(AppRoles))
      .min(1)
      .refine((items) => new Set(items).size === items.length, {
        message: "All roles must be unique, no duplicate values allowed",
      }),
    z.tuple([z.literal("all")]),
  ]),
});

export type GroupMappingCreatePostRequest = z.infer<
  typeof groupMappingCreatePostSchema
>;

export const entraActionResponseSchema = z.object({
  success: z.array(z.object({ email: z.string() })).optional(),
  failure: z
    .array(z.object({ email: z.string(), message: z.string() }))
    .optional(),
});

export type EntraActionResponse = z.infer<typeof entraActionResponseSchema>;

export const groupModificationPatchSchema = z.object({
  add: z.array(z.string()),
  remove: z.array(z.string()),
});

export type GroupModificationPatchRequest = z.infer<
  typeof groupModificationPatchSchema
>;

export const entraGroupMembershipListResponse = z.array(
  z.object({
    name: z.string(),
    email: z.string(),
  }),
);

export type GroupMemberGetResponse = z.infer<
  typeof entraGroupMembershipListResponse
>;

const userOrgSchema = z.object({
  netid: z.string().min(1),
  org: z.enum(OrganizationList),
});
const userOrgsSchema = z.array(userOrgSchema);

const userNameSchema = z.object({
  netid: z.string().min(1),
  firstName: z.string().min(1),
  middleName: z.string().optional(),
  lastName: z.string().min(1),
});
const userNamesSchema = z.array(userNameSchema);

const userSchema = userNameSchema.merge(userOrgSchema);
const usersSchema = z.array(userSchema);

export type UserOrg = z.infer<typeof userOrgSchema>;
export type UserOrgs = z.infer<typeof userOrgsSchema>;
export type UserName = z.infer<typeof userNameSchema>;
export type UserNames = z.infer<typeof userNamesSchema>;
export type User = z.infer<typeof userSchema>;
export type Users = z.infer<typeof usersSchema>;
