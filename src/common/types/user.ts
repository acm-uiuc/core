import * as z from "zod/v4";
import { illinoisUin } from "./generic.js";

export const searchUserByUinRequest = z.object({
  uin: illinoisUin
});

export const searchUserByUinResponse = z.object({
  email: z.email(),
});

export const batchResolveUserInfoRequest = z.object({
  emails: z.array(z.email()).min(1)
})


export const batchResolveUserInfoResponse = z.object({
}).catchall(
  z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional()
  })
);

export type BatchResolveUserInfoResponse = z.infer<typeof batchResolveUserInfoResponse>;
