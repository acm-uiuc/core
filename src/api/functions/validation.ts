import { z } from "zod";

export function validateEmail(email: string): boolean {
  const emailSchema = z.string().email();
  const result = emailSchema.safeParse(email);
  return result.success;
}

export function validateNetId(netId: string): boolean {
  const regex = /^[a-zA-Z]{2}[a-zA-Z\-]*(?:[2-9]|[1-9][0-9]{1,2})?$/;
  return regex.test(netId);
}
