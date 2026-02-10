import * as z from "zod/v4";

export type ShortLinkEntry = {
  slug: string;
  access: string;
  redir?: string;
};

export const LINKRY_MAX_SLUG_LENGTH = 100;

export const getRequest = z.object({
  slug: z.string().min(1).max(LINKRY_MAX_SLUG_LENGTH).optional(),
});

export const linkrySlug = z.string().min(1).max(LINKRY_MAX_SLUG_LENGTH).meta({
  description: "Linkry shortened URL path.",
  example: "shortened_url",
});
export const linkryOrgSlug = z.string().min(0).max(LINKRY_MAX_SLUG_LENGTH).meta({
  description: "Linkry shortened URL path.",
  example: "shortened_url",
});

export const linkryAccessList = z.array(z.string().min(1)).meta({
  description: "List of groups to which access has been delegated.",
  example: [
    "c6a21a09-97c1-4f10-8ddd-fca11f967dc3",
    "88019d41-6c0b-4783-925c-3eb861a1ca0d",
  ],
});

export const createRequest = z.object({
  slug: linkrySlug.refine((url) => !url.includes("#"), {
    message: "Slug must not contain a hashtag",
  }),
  access: linkryAccessList,
  redirect: z.url().min(1).meta({
    description: "Full URL to redirect to when the short URL is visited.",
    example: "https://google.com",
  }),
});

export const createOrgLinkRequest = createRequest.omit({ access: true, slug: true }).extend({
  slug: linkryOrgSlug.refine((url) => !url.includes("#"), {
    message: "Slug must not contain a hashtag",
  })
});

export const linkRecord = z.object({
  access: linkryAccessList,
  slug: linkrySlug,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  redirect: z.url(),
  owner: z.string().min(1),
  isOrgOwned: z.boolean().default(false).meta({
    description: "Whether the link is owned by an organization.",
    example: true,
  }),
});

export const orgLinkRecord = z.object({
  slug: linkryOrgSlug,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  redirect: z.url(),
});

export type LinkRecord = z.infer<typeof linkRecord>;
export type OrgLinkRecord = z.infer<typeof orgLinkRecord>;

export const getLinksResponse = z.object({
  ownedLinks: z.array(linkRecord),
  delegatedLinks: z.array(linkRecord),
});
