import { AllOrganizationIdList, Organizations } from "@acm-uiuc/js-shared";
import * as z from "zod/v4";


export const illinoisSemesterId = z
  .string()
  .length(4)
  .regex(/^(fa|sp|su|wi)\d{2}$/)
  .meta({
    description: "Short semester slug for a given semester.",
    id: "IllinoisSemesterId",
    example: "fa24",
  });

export const illinoisNetId = z
  .string()
  .min(3, { message: "NetID must be at least 3 characters." })
  .max(8, { message: "NetID cannot be more than 8 characters." })
  .regex(/^[a-z]{2}[a-z0-9-]{1,6}$/i, {
    message: "NetID is malformed.",
  })
  .meta({
    description: "Valid Illinois NetID. See https://answers.uillinois.edu/illinois/page.php?id=78766 for more information.",
    example: "rjjones",
    id: "IllinoisNetId",
  });

export const illinoisUin = z
  .string()
  .length(9, { message: "UIN must be 9 characters." })
  .regex(/^\d{9}$/i, {
    message: "UIN is malformed.",
  })
  .meta({
    description: "Valid Illinois UIN.",
    example: "627838939",
    id: "IllinoisUin",
  });


export const OrgUniqueId = z.enum(AllOrganizationIdList).meta({
  description: "The unique org ID for a given ACM sub-organization. See https://github.com/acm-uiuc/js-shared/blob/main/src/orgs.ts#L15",
  examples: ["A01", "C01"],
  id: "OrgUniqueId"
});

export const BooleanFromString = z.preprocess(
  (val) => (typeof val === 'string' || val instanceof String) && val.toLowerCase() === "true",
  z.boolean()
);

// Turns a comma-seperated list of items into an array
export const ArrayFromString = z.preprocess(
  (val) => (typeof val === 'string' ? val.split(',').map((s) => s.trim()).filter(Boolean) : val),
  z.array(z.string())
);

type CheckLength<S extends string, N extends number, Acc extends readonly any[] = []> =
  Acc['length'] extends N
  ? S extends '' ? true : false
  : S extends `${infer _}${infer Rest}`
  ? CheckLength<Rest, N, [...Acc, any]>
  : true;

declare const __maxLength: unique symbol;

/**
 * This type enforces the passing of a string which is:
 * 1. Known at compile-time
 * 2. Has a max length of N
 * The type requested should be MaxLengthString<N>, and all parameters will be called with maxLength("CONST", N);
 */
export type MaxLengthString<N extends number> = string & { readonly [__maxLength]: N };

type ValidateMaxLength<S extends string, N extends number> =
  string extends S
  ? never
  : CheckLength<S, N> extends true
  ? S
  : never;

export const maxLength = <const S extends string, N extends number>(
  s: ValidateMaxLength<S, N>,
  n: N
): MaxLengthString<N> => {
  if (s.length > n) {
    throw new Error(`String "${s}" exceeds max length of ${n}`);
  }
  return s as unknown as MaxLengthString<N>;
};
