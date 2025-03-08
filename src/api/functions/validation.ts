import { z } from "zod";

export function validateEmail(email: string): boolean {
  const emailSchema = z.string().email();
  const result = emailSchema.safeParse(email);
  return result.success;
}

export function validateNetId(netId: string): boolean {
  const regex = /^[a-zA-Z0-9\-]+$/;
  return regex.test(netId);
}
