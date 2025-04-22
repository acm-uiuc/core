import { AppRoles } from "../roles.js";
import { z } from "zod"

export type ApiKeyDynamoEntry = {
  keyId: string;
  keyHash: string;
  roles: AppRoles[];
  owner: string;
  description: string;
  createdAt: number;
  expiresAt?: number;
};

export type DecomposedApiKey = {
  prefix: string;
  id: string;
  rawKey: string;
  checksum: string;
};

export const apiKeyAllowedRoles = [AppRoles.EVENTS_MANAGER, AppRoles.TICKETS_MANAGER, AppRoles.TICKETS_SCANNER, AppRoles.ROOM_REQUEST_CREATE, AppRoles.STRIPE_LINK_CREATOR, AppRoles.LINKS_MANAGER]

export const apiKeyPostBody = z.object({
  roles: z.array(z.enum(apiKeyAllowedRoles as [AppRoles, ...AppRoles[]]))
    .min(1)
    .refine((items) => new Set(items).size === items.length, {
      message: "All roles must be unique, no duplicate values allowed",
    }).openapi({ description: `Roles granted to the API key. These roles are a subset of the overall application roles.` }),
  description: z.string().min(1).openapi({ description: "Description of the key's use.", example: "Publish events to ACM Calendar as part of the CI process." }),
  expiresAt: z.optional(z.number()).refine((val) => val === undefined || val > Date.now() / 1000, {
    message: "expiresAt must be a future epoch time.",
  }).openapi({ description: "Epoch timestamp of when the key expires.", example: 1745362658 })
})
