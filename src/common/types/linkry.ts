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

export const linkrySlug = z.string().min(1).max(LINKRY_MAX_SLUG_LENGTH).openapi({ description: "Linkry shortened URL path.", example: "shortened_url" })
export const linkryAccessList = z.array(z.string()).openapi({
  description: "List of groups to which access has been delegated.", example: ["c6a21a09-97c1-4f10-8ddd-fca11f967dc3", "88019d41-6c0b-4783-925c-3eb861a1ca0d"]
})


export const createRequest = z.object({
  slug: linkrySlug,
  access: linkryAccessList,
  redirect: z.string().url().min(1).openapi({ description: "Full URL to redirect to when the short URL is visited.", example: "https://google.com" }),
});

export const linkRecord = z.object({
  access: linkryAccessList,
  slug: linkrySlug,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  redirect: z.string().url(),
  owner: z.string()
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
