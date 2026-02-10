import { AppRoleHumanMapper, AppRoles } from "common/roles.js";
import { FastifyZodOpenApiSchema } from "fastify-zod-openapi";
import * as z from "zod/v4";
import { AllOrganizationNameList } from "@acm-uiuc/js-shared";
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

export const UnixTimestampSeconds = z.number().int().min(0).meta({
  description: "Unix epoch timestamps (in seconds)",
  id: "UnixTimestampSeconds",
  example: 1705512000,
});

export const groupId = z.string().min(1).meta({
  description: "Entra ID Group ID",
  example: "d8cbb7c9-2f6d-4b7e-8ba6-b54f8892003b",
  id: "EntraGroupId",
});

export const acmCoreOrganization = z
  .enum(AllOrganizationNameList as [string, ...string[]])
  .meta({
    description: "ACM Organization",
    id: "AcmOrganization",
    examples: ["ACM", "Infrastructure Committee"],
  });

export type RoleSchema = {
  "x-required-roles": AppRoles[];
  "x-disable-api-key-auth": boolean;
  description: string;
};

export type TurnstileSchema = {
  "x-turnstile-required": true;
  "x-turnstile-expected-action"?: string | undefined;
  "x-turnstile-expected-hostname"?: string | undefined;
};

export type TurnstileConfig = {
  expectedAction?: string;
  expectedHostname?: string;
};

type RolesConfig = {
  disableApiKeyAuth: boolean;
  notes?: string;
};

export function getCorrectJsonSchema<T, U>({
  schema,
  example,
  description,
}: {
  schema: T;
  example: U;
  description: string;
}) {
  return {
    description,
    content: {
      "application/json": {
        example,
        schema,
      },
    },
  };
}

export const notAuthenticatedError = getCorrectJsonSchema({
  schema: z
    .object({
      error: z.literal(true),
      name: z.literal("UnauthenticatedError"),
      id: z.literal(102),
      message: z.string().min(1),
    })
    .meta({
      id: "notAuthenticatedError",
    }),
  description: "The request could not be authenticated.",
  example: {
    error: true,
    name: "UnauthenticatedError",
    id: 102,
    message: "Token not found.",
  },
});

export const notFoundError = getCorrectJsonSchema({
  schema: z
    .object({
      error: z.literal(true),
      name: z.literal("NotFoundError"),
      id: z.literal(103),
      message: z.string().min(1),
    })
    .meta({
      id: "notFoundError",
    }),
  description: "The resource could not be found.",
  example: {
    error: true,
    name: "NotFoundError",
    id: 103,
    message: "{url} is not a valid URL.",
  },
});

export const notAuthorizedError = getCorrectJsonSchema({
  schema: z
    .object({
      error: z.literal(true),
      name: z.literal("UnauthorizedError"),
      id: z.literal(101),
      message: z.string().min(1),
    })
    .meta({
      id: "notAuthorizedError",
    }),
  description:
    "The caller does not have the appropriate permissions for this task.",
  example: {
    error: true,
    name: "UnauthorizedError",
    id: 101,
    message: "User does not have the privileges for this task.",
  },
});

export const resourceConflictError = getCorrectJsonSchema({
  schema: z
    .object({
      error: z.literal(true),
      name: z.literal("ResourceConflictError"),
      id: z.literal(112),
      message: z.string().min(1),
    })
    .meta({
      id: "resourceConflictError",
      description:
        "The request could not be completed due to a conflict with the current state of the resource.",
    }),
  description:
    "The request could not be completed due to a conflict with the current state of the resource.",
  example: {
    error: true,
    name: "ResourceConflictError",
    id: 112,
    message: "A resource with the same identifier already exists.",
  },
});

export const internalServerError = getCorrectJsonSchema({
  schema: {
    content: {
      "application/json": {
        schema: z
          .object({
            error: z.literal(true),
            name: z.literal("InternalServerError"),
            id: z.literal(100),
            message: z.string().min(1),
          })
          .meta({
            id: "internalServerError",
            description:
              "The server encountered an error processing the request.",
          }),
      },
    },
  },
  description: "The server encountered an error processing the request.",
  example: {
    error: true,
    name: "InternalServerError",
    id: 100,
    message:
      "An internal server error occurred. Please try again or contact support.",
  },
});

export const rateLimitExceededError = getCorrectJsonSchema({
  schema: z
    .object({
      error: z.literal(true),
      name: z.literal("RateLimitExceededError"),
      id: z.literal(409),
      message: z.literal("Rate limit exceeded."),
    })
    .meta({
      id: "rateLimitExceededError",
      description: "The caller has sent too many requests. Try again later.",
    }),
  description: "The caller has sent too many requests. Try again later.",
  example: {
    error: true,
    name: "RateLimitExceededError",
    id: 409,
    message: "Rate limit exceeded.",
  },
});

export const validationError = getCorrectJsonSchema({
  schema: z
    .object({
      error: z.literal(true),
      name: z.string().min(1),
      id: z.number(),
      message: z.string().min(1),
    })
    .meta({
      id: "validationError",
      description: "The request is invalid.",
    }),
  description: "The request is invalid.",
  example: {
    error: true,
    name: "ValidationError",
    id: 104,
    message: "Request is invalid.",
  },
});

export function withRoles<T extends FastifyZodOpenApiSchema>(
  roles: AppRoles[],
  schema: T,
  { disableApiKeyAuth, notes }: RolesConfig = { disableApiKeyAuth: false },
): T & RoleSchema {
  const security = [{ httpBearer: [] }] as any;
  if (!disableApiKeyAuth) {
    security.push({ apiKeyHeader: [] });
  }
  const responses = {
    401: notAuthenticatedError,
    403: notAuthorizedError,
    ...schema.response,
  };
  return {
    security,
    "x-required-roles": roles,
    "x-disable-api-key-auth": disableApiKeyAuth,
    description: `
${
  disableApiKeyAuth
    ? `
> [!important]
> This resource cannot be accessed with an API key.
`
    : ""
}

${
  schema.description
    ? `
#### Description
<hr />
${schema.description}
`
    : ""
}

#### Authorization
<hr />
${roles.length > 0 ? `Requires any of the following roles:\n\n${roles.map((item) => `* ${AppRoleHumanMapper[item]} (<code>${item}</code>)`).join("\n")}` : "Requires valid authentication but no specific authorization."}

${notes ? `${notes}\n` : ""}
  `,
    ...schema,
    response: responses,
  };
}

export function withTags<T extends FastifyZodOpenApiSchema>(
  tags: string[],
  schema: T,
) {
  const responses = {
    500: internalServerError,
    429: rateLimitExceededError,
    400: validationError,
    ...schema.response,
  };
  return {
    tags,
    ...schema,
    response: responses,
  };
}

export const turnstileResponseHeader = z.string().min(1).max(2048).meta({
  description: "Cloudflare Turnstile response token",
  id: "TurnstileResponseHeader",
});

export function withTurnstile<T extends FastifyZodOpenApiSchema>(
  config: TurnstileConfig,
  schema: T,
): T & TurnstileSchema {
  if (schema.headers && !(schema.headers instanceof z.ZodObject)) {
    throw new Error("withTurnstile requires schema.headers to be a z.object()");
  }

  const headersWithTurnstile = schema.headers
    ? schema.headers.extend({ "x-turnstile-response": turnstileResponseHeader })
    : z.object({ "x-turnstile-response": turnstileResponseHeader });

  return {
    "x-turnstile-required": true,
    "x-turnstile-expected-action": config.expectedAction,
    "x-turnstile-expected-hostname": config.expectedHostname,
    ...schema,
    headers: headersWithTurnstile,
  };
}
