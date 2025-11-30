import * as z from "zod/v4";

export const rsvpItemSchema = z.object({
  eventId: z.string(),
  userId: z.string(),
  isPaidMember: z.boolean(),
  createdAt: z.string(),
});
