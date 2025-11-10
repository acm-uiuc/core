import * as z from "zod/v4";
import { illinoisUin } from "./generic.js";

export const searchUserByUinRequest = z.object({
  uin: illinoisUin
});

export const searchUserByUinResponse = z.object({
  email: z.email(),
});
