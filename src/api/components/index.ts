import { z } from "zod";

export const ts = z.coerce
  .number()
  .min(0)
  .optional()
  .openapi({ description: "Staleness bound", example: 0 });
export const groupId = z.string().min(1).openapi({
  description: "Entra ID Group ID",
  example: "d8cbb7c9-2f6d-4b7e-8ba6-b54f8892003b",
});

export function withTags<T>(tags: string[], schema: T) {
  return {
    tags,
    ...schema,
  };
}
