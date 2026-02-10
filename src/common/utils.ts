import * as z from "zod/v4";
import { ValidationError } from "./errors/index.js";
export function transformCommaSeperatedName(name: string) {
  if (name.includes(",")) {
    try {
      const split = name.split(",");
      if (split.filter((x) => x !== " " && x !== "").length !== 2) {
        return name;
      }
      return `${split[1].slice(1, split[1].length).split(" ")[0]} ${split[0]}`;
    } catch {
      return name;
    }
  }
  return name;
}

type GenerateProjectionParamsInput = {
  userFields?: string[];
};
/**
 * Generates DynamoDB projection parameters for select filters, while safely handle reserved keywords.
 */
export const generateProjectionParams = ({
  userFields,
}: GenerateProjectionParamsInput) => {
  const attributes = userFields || [];
  const expressionAttributeNames: Record<string, string> = {};
  const projectionExpression = attributes
    .map((attr, index) => {
      const placeholder = `#proj${index}`;
      expressionAttributeNames[placeholder] = attr;
      return placeholder;
    })
    .join(",");
  return {
    ProjectionExpression: projectionExpression,
    ExpressionAttributeNames: expressionAttributeNames,
  };
};

export const nonEmptyCommaSeparatedStringSchema = z
  .array(z.string().min(1))
  .min(1, { message: "Filter expression must select at least one item." })
  .transform((val) => val.map((item) => item.trim()));

type GetDefaultFilteringQuerystringInput = {
  defaultSelect: string[];
};
export const getDefaultFilteringQuerystring = ({
  defaultSelect,
}: GetDefaultFilteringQuerystringInput) => {
  return {
    select: z
      .optional(nonEmptyCommaSeparatedStringSchema)
      .default(defaultSelect)
      .meta({
        description: "A list of attributes to return.",
        ...(defaultSelect.length === 0
          ? { default: ["<ALL ATTRIBUTES>"] }
          : { example: defaultSelect }),
      }),
  };
};

export const getAllUserEmails = (username?: string) => {
  if (!username) {
    return [];
  }
  return [username.replace("@illinois.edu", "@acm.illinois.edu")];
};

/**
 * Extracts the netId from an Illinois email address.
 * @param email - The email address (e.g., "netid@illinois.edu")
 * @returns The netId in lowercase
 */
export function getNetIdFromEmail(email: string): string {
  const normalizedEmail = email.toLowerCase();
  if (!normalizedEmail.endsWith("@illinois.edu") && !normalizedEmail.endsWith("@acm.illinois.edu")) {
    throw new ValidationError({ message: "Email cannot be converted to NetID by simple replacment." })
  }
  const [netId] = normalizedEmail.split("@");
  return netId.toLowerCase();
}


/**
 * Encodes an invoice payment token in the format:
 * Base64URL(orgId#emailDomain#invoiceId)
 */
export function encodeInvoiceToken({
  orgId,
  emailDomain,
  invoiceId,
}: {
  orgId: string;
  emailDomain: string;
  invoiceId: string;
}): string {
  return Buffer.from(
    `${orgId}#${emailDomain}#${invoiceId}`,
    "utf8",
  ).toString("base64url");
}

/**
 * Decodes and validates an invoice payment token.
 */
export function decodeInvoiceToken(token: string): {
  orgId: string;
  emailDomain: string;
  invoiceId: string;
} {
  let decoded: string;

  try {
    decoded = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    throw new ValidationError({ message: "Invalid invoice token encoding." });
  }

  const [orgId, emailDomain, invoiceId] = decoded.split("#");

  if (!orgId || !emailDomain || !invoiceId) {
    throw new ValidationError({ message: "Malformed invoice token." });
  }

  return { orgId, emailDomain, invoiceId };
}
