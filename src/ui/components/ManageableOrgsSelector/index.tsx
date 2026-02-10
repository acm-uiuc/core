import { useEffect, useState } from "react";
import { Select, SelectProps } from "@mantine/core";
import {
  AllOrganizationIdList,
  OrganizationId,
  Organizations,
} from "@acm-uiuc/js-shared";
import { getUserRoles, getCoreOrgRoles } from "@ui/components/AuthGuard";
import { AppRoles } from "@common/roles";

interface ManageableOrgsSelectorProps extends Omit<
  SelectProps,
  "data" | "value" | "onChange"
> {
  /** App roles that grant visibility to all organizations. Default: [ALL_ORG_MANAGER] */
  adminRoles?: AppRoles[];
  /** Override to show all organizations regardless of roles (e.g., view-only mode) */
  showAllOrgs?: boolean;
  value: OrganizationId | null;
  onChange: (org: OrganizationId | null) => void;
  /** Called once the manageable orgs list has been determined */
  onOrgsLoaded?: (orgs: OrganizationId[]) => void;
  /** Whether or not the overall ACM org should be hidden as an option */
  hideAcmOrg?: boolean;
}

export const ManageableOrgsSelector: React.FC<ManageableOrgsSelectorProps> = ({
  adminRoles = [AppRoles.ALL_ORG_MANAGER],
  showAllOrgs = false,
  value,
  onChange,
  onOrgsLoaded,
  hideAcmOrg,
  ...selectProps
}) => {
  const [manageableOrgs, setManageableOrgsInt] = useState<
    OrganizationId[] | null
  >(null);

  const setManageableOrgs = (data: OrganizationId[] | null) => {
    const realOrgs =
      hideAcmOrg && data ? data.filter((x) => x !== "A01") : data;
    setManageableOrgsInt(realOrgs);
  };

  useEffect(() => {
    if (showAllOrgs) {
      const allOrgs = [...AllOrganizationIdList];
      setManageableOrgs(allOrgs);
      onOrgsLoaded?.(allOrgs);
      return;
    }

    (async () => {
      const appRoles = await getUserRoles("core");
      const orgRoles = await getCoreOrgRoles();
      if (appRoles === null || orgRoles === null) {
        setManageableOrgs([]);
        onOrgsLoaded?.([]);
        return;
      }
      if (adminRoles.some((role) => appRoles.includes(role))) {
        const allOrgs = [...AllOrganizationIdList];
        setManageableOrgs(allOrgs);
        onOrgsLoaded?.(allOrgs);
        return;
      }
      const leadOrgs = orgRoles
        .filter((x) => x.role === "LEAD")
        .map((x) => x.org);
      setManageableOrgs(leadOrgs);
      onOrgsLoaded?.(leadOrgs);
    })();
  }, [showAllOrgs]);

  if (manageableOrgs === null) {
    return null;
  }

  return (
    <Select
      data={manageableOrgs.map((x) => ({
        value: x,
        label: Organizations[x].name,
      }))}
      value={value}
      onChange={(v) => onChange(v as OrganizationId | null)}
      searchable
      {...selectProps}
    />
  );
};
