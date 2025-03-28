import { z } from "zod";
import { OrganizationList } from "../orgs";

export const roomRequestPostSchema = z.object({
  organization: z.enum(OrganizationList),
  name: z.string().min(1),
  description: z.string().min(1),
  start: z.number().min(0),
  end: z.number().min(0).max(604800),
});

export type RoomRequestPostRequest = z.infer<typeof roomRequestPostSchema>;
