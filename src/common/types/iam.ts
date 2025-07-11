import { AppRoles } from "../roles.js";
import * as z from "zod/v4";

export enum EntraGroupActions {
  ADD,
  REMOVE,
}

export interface EntraGroupMetadata {
  id: string;
  displayName: string;
  mail: string | null;
  description: string | null;
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
  emails: z.array(z.string())
});

export type InviteUserPostRequest = z.infer<typeof invitePostRequestSchema>;

export const groupMappingCreatePostSchema = z.object({
  roles: z.union([
    z.
      array(z.nativeEnum(AppRoles)).
      min(1).
      refine((items) => new Set(items).size === items.length, {
        message: "All roles must be unique, no duplicate values allowed"
      }),
    z.tuple([z.literal("all")])]
  )
});

export type GroupMappingCreatePostRequest = z.infer<
  typeof groupMappingCreatePostSchema>;


export const entraActionResponseSchema = z.object({
  success: z.array(z.object({ email: z.string() })).optional(),
  failure: z.
    array(z.object({ email: z.string(), message: z.string() })).
    optional()
});

export type EntraActionResponse = z.infer<typeof entraActionResponseSchema>;

export type GroupGetResponse = { id: string; displayName: string; }[];

export const groupModificationPatchSchema = z.object({
  add: z.array(z.string()),
  remove: z.array(z.string())
});

export type GroupModificationPatchRequest = z.infer<
  typeof groupModificationPatchSchema>;


export const entraGroupMembershipListResponse = z.array(
  z.object({
    name: z.string(),
    email: z.string()
  })
);

export type GroupMemberGetResponse = z.infer<
  typeof entraGroupMembershipListResponse>;


export const entraProfilePatchRequest = z.object({
  displayName: z.string().min(1),
  givenName: z.string().min(1),
  surname: z.string().min(1),
  mail: z.email()
});

export type ProfilePatchRequest = z.infer<typeof entraProfilePatchRequest>;
