import { z } from "zod";

export type ShortLinkEntry = {
  slug: string;
  access: string;
  redir?: string;
}

export const LINKRY_MAX_SLUG_LENGTH = 1000;

export const getRequest = z.object({
  slug: z.string().min(1).max(LINKRY_MAX_SLUG_LENGTH).optional(),
});

export const createRequest = z.object({
  slug: z.string().min(1).max(LINKRY_MAX_SLUG_LENGTH),
  access: z.array(z.string()),
  redirect: z.string().url().min(1),
  counter: z.number().optional(),
});

export const linkRecord = z.object({
  access: z.array(z.string()),
  slug: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  redirect: z.string().url(),
  owner: z.string().optional()
})

export const delegatedLinkRecord = linkRecord.extend({
  owner: z.string().min(1)
})

export type LinkRecord = z.infer<typeof linkRecord>;

export type DelegatedLinkRecord = z.infer<typeof delegatedLinkRecord>;

export const getLinksResponse = z.object({
  ownedLinks: z.array(linkRecord),
  delegatedLinks: z.array(linkRecord)
})
