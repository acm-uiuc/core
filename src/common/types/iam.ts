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
  roles: z
    .array(z.nativeEnum(AppRoles))
    .min(1)
    .refine((items) => new Set(items).size === items.length, {
      message: "All roles must be unique, no duplicate values allowed",
    }),
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
