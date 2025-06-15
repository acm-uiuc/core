import { Modules } from "../modules.js";
import { z } from "zod";

export const loggingEntry = z.object({
  module: z.nativeEnum(Modules),
  actor: z.string().min(1),
  target: z.string().min(1),
  requestId: z.optional(z.string().min(1).uuid()),
  message: z.string().min(1)
})

export const loggingEntryFromDatabase = loggingEntry.extend({
  createdAt: z.number().min(1),
  expireAt: z.number().min(2)
})

export type AuditLogEntry = z.infer<typeof loggingEntry>
