import { ACMOrganization } from "@acm-uiuc/js-shared";
import { OrgRoleDefinition } from "@common/roles";

export type NonEmptyArray<T> = [T, ...T[]];

export function min<T>(items: NonEmptyArray<T>): T {
  let currentMin: T = items[0];
  for (let i = 0; i < items.length; i++) {
    if (items[i] < currentMin) {
      currentMin = items[i];
    }
  }
  return currentMin;
}

export function getPrimarySuggestedOrg(
  orgRoles: OrgRoleDefinition[] | null | undefined,
): ACMOrganization {
  if (!orgRoles || orgRoles.length === 0) {
    return "";
  }
  const leadOrgs = orgRoles.filter((x) => x.role === "LEAD").map((x) => x.org);
  if (leadOrgs.length > 0) {
    return min(leadOrgs as NonEmptyArray<ACMOrganization>);
  }
  return "";
}
