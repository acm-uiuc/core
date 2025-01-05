import { AppRoles } from "../roles.js";
import { z } from "zod";

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

export const invitePostResponseSchema = z.object({
  success: z.array(z.object({ email: z.string() })).optional(),
  failure: z
    .array(z.object({ email: z.string(), message: z.string() }))
    .optional(),
});

export type InvitePostResponse = z.infer<typeof invitePostResponseSchema>;
