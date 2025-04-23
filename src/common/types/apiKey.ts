import { AuthorizationPoliciesRegistry, AvailableAuthorizationPolicy } from "../policies/definition.js";
import { AppRoles } from "../roles.js";
import { z } from "zod";
import { InternalServerError } from "../errors/index.js";
export type ApiKeyMaskedEntry = {
  keyId: string;
  roles: AppRoles[];
  owner: string;
  description: string;
  createdAt: number;
  expiresAt?: number;
  restrictions?: AvailableAuthorizationPolicy[];
}
export type ApiKeyDynamoEntry = ApiKeyMaskedEntry & {
  keyHash: string;
};

export type DecomposedApiKey = {
  prefix: string;
  id: string;
  rawKey: string;
  checksum: string;
};

const policySchemas = Object.entries(AuthorizationPoliciesRegistry).map(
  ([key, policy]) =>
    z.object({
      name: z.literal(key),
      params: policy.paramsSchema,
    })
);

if (policySchemas.length === 0) {
  throw new InternalServerError({
    message: "No authorization policies are defined in AuthorizationPoliciesRegistry. 'restrictions' will be an empty schema."
  })
}

const policyUnion = policySchemas.length > 0
  ? z.discriminatedUnion("name", policySchemas as [typeof policySchemas[0], ...typeof policySchemas])
  : z.never();

export const apiKeyAllowedRoles = [
  AppRoles.EVENTS_MANAGER,
  AppRoles.TICKETS_MANAGER,
  AppRoles.TICKETS_SCANNER,
  AppRoles.ROOM_REQUEST_CREATE,
  AppRoles.STRIPE_LINK_CREATOR,
  AppRoles.LINKS_MANAGER,
];

export const apiKeyPostBody = z.object({
  roles: z.array(z.enum(apiKeyAllowedRoles as [AppRoles, ...AppRoles[]]))
    .min(1)
    .refine((items) => new Set(items).size === items.length, {
      message: "All roles must be unique, no duplicate values allowed",
    }).openapi({
      description: `Roles granted to the API key. These roles are a subset of the overall application roles.`,
    }),
  description: z.string().min(1).openapi({
    description: "Description of the key's use.",
    example: "Publish events to ACM Calendar as part of the CI process.",
  }),
  expiresAt: z.optional(z.number().refine((val) => val === undefined || val > Date.now() / 1000, {
    message: "expiresAt must be a future epoch time.",
  })).openapi({
    description: "Epoch timestamp of when the key expires.",
    example: 1745362658,
  }),
  restrictions: z.optional(z.array(policyUnion)).openapi({ description: "Policy restrictions applied to the API key." }),
});

export type ApiKeyPostBody = z.infer<typeof apiKeyPostBody>;
