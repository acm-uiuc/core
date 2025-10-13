import { OrganizationId } from "@acm-uiuc/js-shared";

/**
 * Skip creating/updating external Entra Groups for these org's leads
 * These org's leads are managed directly in Entra ID due to their sensitive nature.
 * We only perform the metadata update in DynamoDB for these orgs.
 */
export const SKIP_EXTERNAL_ORG_LEAD_UPDATE: OrganizationId[] = ["A01", "C01"]
