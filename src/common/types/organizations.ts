import { AllOrganizationList } from "@acm-uiuc/js-shared";
import { z } from "zod/v4";


export const orgLeadEntry = z.object({
  name: z.optional(z.string()),
  username: z.email(),
  title: z.optional(z.string())
})

export const validOrgLinkTypes = ["DISCORD", "CAMPUSWIRE", "SLACK", "NOTION", "MATRIX", "OTHER"] as const as [string, ...string[]];

export const orgLinkEntry = z.object({
  type: z.enum(validOrgLinkTypes),
  url: z.url()
})


export const getOrganizationInfoResponse = z.object({
  id: z.enum(AllOrganizationList),
  description: z.optional(z.string()),
  website: z.optional(z.url()),
  leads: z.optional(z.array(orgLeadEntry)),
  links: z.optional(z.array(orgLinkEntry))
})

export const setOrganizationMetaBody = getOrganizationInfoResponse.omit({ id: true, leads: true });
