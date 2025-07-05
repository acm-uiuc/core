import * as z from "zod/v4";

export const MAX_METADATA_KEYS = 10;
export const MAX_KEY_LENGTH = 50;
export const MAX_VALUE_LENGTH = 1000;


export const metadataSchema = z.record(z.string(), z.string()).
  optional().
  superRefine((metadata, ctx) => {
    if (!metadata) return;

    const keys = Object.keys(metadata);

    if (keys.length > MAX_METADATA_KEYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Metadata may have at most ${MAX_METADATA_KEYS} keys.`
      });
    }

    for (const key of keys) {
      if (key.length > MAX_KEY_LENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Metadata key "${key}" exceeds ${MAX_KEY_LENGTH} characters.`
        });
      }

      const value = metadata[key];
      if (value.length > MAX_VALUE_LENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Metadata value for key "${key}" exceeds ${MAX_VALUE_LENGTH} characters.`
        });
      }
    }
  });
