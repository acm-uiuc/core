import { ACMOrganization } from "@acm-uiuc/js-shared";
import { OrgRoleDefinition } from "@common/roles";

export function getPrimarySuggestedOrg(
  orgRoles: OrgRoleDefinition[] | null | undefined,
): ACMOrganization {
  if (!orgRoles || orgRoles.length === 0) {
    return "";
  }
  const leadOrgs = orgRoles
    .filter((x) => x.role === "LEAD")
    .map((x) => x.org)
    .sort();
  if (leadOrgs.length > 0) {
    return leadOrgs[0];
  }
  return "";
}
