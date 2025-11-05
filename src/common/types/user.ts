import * as z from "zod/v4";

export const searchUserByUinRequest = z.object({
  uin: z.string().length(9)
});

export const searchUserByUinResponse = z.object({
  email: z.email(),
});
