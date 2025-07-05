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

const notUnreservedCharsRegex = /[^a-zA-Z0-9\-._~]/g;
const reservedCharsRegex = /[:\/?#\[\]@!$&'()*+,;=]/g;
/**
 * Transforms an organization name (sig lead) into a URI-friendly format.
 * The function performs the following transformations:
 * - Removes characters that are reserved or not unreserved.
 * - Adds spaces between camel case words.
 * - Converts reserved characters to spaces.
 * - Converts all characters to lowercase and replaces all types of whitespace with hyphens.
 * - Replaces any sequence of repeated hyphens with a single hyphen.
 * - Refer to RFC 3986 https://datatracker.ietf.org/doc/html/rfc3986#section-2.3
 *
 * @param {string} org - The organization (sig lead) name to be transformed.
 * @returns {string} - The transformed organization name, ready for use as a URL.
 */
export function transformSigLeadToURI(org: string) {
  // console.log(`org\t${org}`)
  org = org
    // change not reserved chars to spaces
    .trim()
    .replace(notUnreservedCharsRegex, " ")
    .trim()
    .replace(/\s/g, "-")

    // remove all that is reserved or not unreserved
    .replace(reservedCharsRegex, "")

    // convert SIG -> sig for camel case
    .replace(/SIG/g, "sig")

    // add hyphen for camel case
    .replace(/([a-z])([A-Z])/g, "$1-$2")

    // lower
    .toLowerCase()
    
    // add spaces between chars and numbers (seq2seq -> seq-2-seq)
    .replace(/(?<=[a-z])([0-9]+)(?=[a-z])/g, "-$1-")

    // remove duplicate hyphens
    .replace(/-{2,}/g, "-");

  return org === "-" ? "" : org;
}

export function getTimeInFormat() {
  const date = new Date();
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`;

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


export const nonEmptyCommaSeparatedStringSchema = z
  .string({ invalid_type_error: "Filter expression must be a string." })
  .min(1, { message: "Filter expression must be at least 1 character long." })
  .transform((val) => val.split(',').map(item => item.trim()))
  .pipe(z.array(z.string()).nonempty());

type GetDefaultFilteringQuerystringInput = {
  defaultSelect: string[];
}
export const getDefaultFilteringQuerystring = ({ defaultSelect }: GetDefaultFilteringQuerystringInput) => {
  return {
    select: z.optional(nonEmptyCommaSeparatedStringSchema).default(defaultSelect.join(',')).openapi({
      description: "Comma-seperated list of attributes to return",
      ...(defaultSelect.length === 0 ? { default: "<ALL ATTRIBUTES>" } : {}),
    })
  }
}
