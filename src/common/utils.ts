import * as z from "zod/v4";
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
export const generateProjectionParams = ({ userFields }: GenerateProjectionParamsInput) => {
  const attributes = userFields || [];
  const expressionAttributeNames: Record<string, string> = {};
  const projectionExpression = attributes.
    map((attr, index) => {
      const placeholder = `#proj${index}`;
      expressionAttributeNames[placeholder] = attr;
      return placeholder;
    }).
    join(',');
  return {
    ProjectionExpression: projectionExpression,
    ExpressionAttributeNames: expressionAttributeNames
  };
};


export const nonEmptyCommaSeparatedStringSchema = z.
  array(z.string().min(1)).
  min(1, { message: "Filter expression must select at least one item." }).
  transform((val) => val.map((item) => item.trim()))

type GetDefaultFilteringQuerystringInput = {
  defaultSelect: string[];
};
export const getDefaultFilteringQuerystring = ({ defaultSelect }: GetDefaultFilteringQuerystringInput) => {
  return {
    select: z.optional(nonEmptyCommaSeparatedStringSchema).default(defaultSelect).meta({
      description: "A list of attributes to return.",
      ...(defaultSelect.length === 0 ? { default: ["<ALL ATTRIBUTES>"] } : { example: defaultSelect })
    })
  };
};

export const getAllUserEmails = (username?: string) => {
  if (!username) {
    return [];
  }
  return [username.replace("@illinois.edu", "@acm.illinois.edu")]
}


/**
 * Parses a display name into first and last name components
 * Handles common formats:
 * - "First Last"
 * - "Last, First"
 * - "First Middle Last" (treats everything except last word as first name)
 * - Single names (treated as first name)
 */
export const parseDisplayName = (displayName: string): { givenName: string; familyName: string } => {
  if (!displayName || displayName.trim() === '') {
    return { givenName: '', familyName: '' };
  }

  const trimmed = displayName.trim();

  // Handle "Last, First" format
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',').map(p => p.trim());
    return {
      familyName: parts[0] || '',
      givenName: parts[1] || ''
    };
  }

  // Handle "First Last" or "First Middle Last" format
  const parts = trimmed.split(/\s+/);

  if (parts.length === 1) {
    // Single name - treat as first name
    return {
      givenName: parts[0],
      familyName: ''
    };
  }

  if (parts.length === 2) {
    // Simple "First Last"
    return {
      givenName: parts[0],
      familyName: parts[1]
    };
  }

  // Multiple parts - last part is family name, rest is given name
  const familyName = parts[parts.length - 1];
  const givenName = parts.slice(0, -1).join(' ');

  return { givenName, familyName };
};
