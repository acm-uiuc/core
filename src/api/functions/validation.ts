import * as z from "zod/v4";

export function validateEmail(email: string): boolean {
  const emailSchema = z.email();
  const result = emailSchema.safeParse(email);
  return result.success;
}

export function validateNetId(netId: string): boolean {
  const regex = /^[a-zA-Z]{2}[a-zA-Z-]*(?:[2-9]|[1-9][0-9]{1,2})?$/;
  return netId.length >= 3 && netId.length <= 8 && regex.test(netId);
}
