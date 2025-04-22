import { z } from "zod";

export const MAX_METADATA_KEYS = 10;
export const MAX_STRING_LENGTH = 100;

export const metadataSchema = z
  .record(z.string())
  .optional()
  .superRefine((metadata, ctx) => {
    if (!metadata) return;

    const keys = Object.keys(metadata);

    if (keys.length > MAX_METADATA_KEYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Metadata may have at most ${MAX_METADATA_KEYS} keys.`,
      });
    }

    for (const key of keys) {
      if (key.length > MAX_STRING_LENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Metadata key "${key}" exceeds ${MAX_STRING_LENGTH} characters.`,
        });
      }

      const value = metadata[key];
      if (value.length > MAX_STRING_LENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Metadata value for key "${key}" exceeds ${MAX_STRING_LENGTH} characters.`,
        });
      }
    }
  });
