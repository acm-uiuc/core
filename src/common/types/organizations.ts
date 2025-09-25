import { AllOrganizationList } from "@acm-uiuc/js-shared";
import { AppRoleHumanMapper, AppRoles } from "../roles.js";
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

export const enforcedOrgLeadEntry = orgLeadEntry.extend({ name: z.string().min(1), title: z.string().min(1) })


export const getOrganizationInfoResponse = z.object({
  id: z.enum(AllOrganizationList),
  description: z.optional(z.string()),
  website: z.optional(z.url()),
  leads: z.optional(z.array(orgLeadEntry)),
  links: z.optional(z.array(orgLinkEntry)),
  leadsEntraGroupId: z.optional(z.string().min(1)).meta({ description: `Only returned for users with the ${AppRoleHumanMapper[AppRoles.ALL_ORG_MANAGER]} role.` })
})

export const setOrganizationMetaBody = getOrganizationInfoResponse.omit({ id: true, leads: true });
export const patchOrganizationLeadsBody = z.object({
  add: z.array(enforcedOrgLeadEntry),
  remove: z.array(z.string())
});
