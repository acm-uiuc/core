import * as z from "zod/v4";
export const postMetadataSchema = z.object({
  type: z.union([z.literal("merch"), z.literal("ticket")]),
  itemSalesActive: z.union([z.date(), z.boolean()])
});

export type ItemPostData = z.infer<typeof postMetadataSchema>;