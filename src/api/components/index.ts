import { AppRoles } from "common/roles.js";
import { FastifyZodOpenApiSchema } from "fastify-zod-openapi";
import * as z from "zod/v4";
import { CoreOrganizationList } from "@acm-uiuc/js-shared";
export {
  illinoisSemesterId as semesterId,
  illinoisNetId,
} from "../../common/types/generic.js";

export const ts = z.coerce.number().min(0).optional().meta({
  description:
    "Staleness bound as Unix epoch time (requires authentication to specify)",
  example: 1752248256,
  id: "AcmStalenessBoundTimestamp",
});

export const groupId = z.string().min(1).meta({
  description: "Entra ID Group ID",
  example: "d8cbb7c9-2f6d-4b7e-8ba6-b54f8892003b",
  id: "EntraGroupId",
});

export const acmCoreOrganization = z
  .enum(CoreOrganizationList as [string, ...string[]])
  .meta({
    description: "ACM Organization",
    id: "AcmOrganization",
    examples: ["ACM", "Infrastructure Committee"],
  });

export function withTags<T extends FastifyZodOpenApiSchema>(
  tags: string[],
  schema: T,
) {
  return {
    tags,
    ...schema,
  };
}

export type RoleSchema = {
  "x-required-roles": AppRoles[];
  "x-disable-api-key-auth": boolean;
  description: string;
};

type RolesConfig = {
  disableApiKeyAuth: boolean;
};

export function withRoles<T extends FastifyZodOpenApiSchema>(
  roles: AppRoles[],
  schema: T,
  { disableApiKeyAuth }: RolesConfig = { disableApiKeyAuth: false },
): T & RoleSchema {
  const security = [{ bearerAuth: [] }] as any;
  if (!disableApiKeyAuth) {
    security.push({ apiKeyAuth: [] });
  }
  return {
    security,
    "x-required-roles": roles,
    "x-disable-api-key-auth": disableApiKeyAuth,
    description:
      roles.length > 0
        ? `${disableApiKeyAuth ? "API key authentication is not permitted for this route.\n\n" : ""}Requires one of the following roles: ${roles.join(", ")}.${schema.description ? `\n\n${schema.description}` : ""}`
        : "Requires valid authentication but no specific role.",
    ...schema,
  };
}
