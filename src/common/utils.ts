import { z } from "zod";
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
}
/**
 * Generates DynamoDB projection parameters for select filters, while safely handle reserved keywords.
 */
export const generateProjectionParams = ({ userFields }: GenerateProjectionParamsInput) => {
  const attributes = userFields || [];
  const expressionAttributeNames: Record<string, string> = {};
  const projectionExpression = attributes
    .map((attr, index) => {
      const placeholder = `#proj${index}`;
      expressionAttributeNames[placeholder] = attr;
      return placeholder;
    })
    .join(',');
  return {
    ProjectionExpression: projectionExpression,
    ExpressionAttributeNames: expressionAttributeNames,
  };
};


export const nonEmptyCommaSeparatedStringSchema = z.preprocess(
  (val) => String(val).split(',').map(item => item.trim()),
  z.array(z.string()).nonempty()
);

type GettDefaultFilteringQuerystringInput = {
  defaultSelect: string[];
}
export const getDefaultFilteringQuerystring = ({ defaultSelect }: GettDefaultFilteringQuerystringInput) => {
  return {
    select: z.optional(nonEmptyCommaSeparatedStringSchema).default(defaultSelect.join(',')).openapi({
      description: "Comma-seperated list of attributes to return",
    })
  }
}
