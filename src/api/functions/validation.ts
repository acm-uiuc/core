import { z } from "zod";

export function validateEmail(email: string): boolean {
  const emailSchema = z.string().email();
  const result = emailSchema.safeParse(email);
  return result.success;
}

export function validateNetId(netId: string): boolean {
  // TODO: write this function to check if the netid matches this regex: [a-zA-Z0-9\-]+
  return true;
}
