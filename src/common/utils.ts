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
