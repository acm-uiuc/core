import { AllOrganizationNameList } from "@acm-uiuc/js-shared";

/* eslint-disable import/prefer-default-export */
export const runEnvironments = ["dev", "prod"] as const;
export type RunEnvironment = (typeof runEnvironments)[number];
export const META_ROLE_PREFIX = "__metaRole:"

export enum BaseRoles {
  EVENTS_MANAGER = "manage:events",
  RSVPS_MANAGER = "manage:rsvps",
  VIEW_RSVPS = "view:rsvps",
  TICKETS_SCANNER = "scan:tickets",
  TICKETS_MANAGER = "manage:tickets",
  IAM_ADMIN = "admin:iam",
  IAM_INVITE_ONLY = "invite:iam",
  LINKS_MANAGER = "manage:links",
  LINKS_ADMIN = "admin:links",
  STRIPE_LINK_CREATOR = "create:stripeLink",
  BYPASS_OBJECT_LEVEL_AUTH = "bypass:ola",
  ROOM_REQUEST_CREATE = "create:roomRequest",
  ROOM_REQUEST_UPDATE = "update:roomRequest",
  AUDIT_LOG_VIEWER = "view:auditLog",
  MANAGE_ORG_API_KEYS = "manage:orgApiKey",
  VIEW_INTERNAL_MEMBERSHIP_LIST = "view:internalMembershipList",
  VIEW_EXTERNAL_MEMBERSHIP_LIST = "view:externalMembershipList",
  MANAGE_EXTERNAL_MEMBERSHIP_LIST = "manage:externalMembershipList",
  ALL_ORG_MANAGER = "manage:orgDefinitions",
  VIEW_USER_INFO = "view:userInfo",
}

export enum MetaRoles {
  AT_LEAST_ONE_ORG_MANAGER = `${META_ROLE_PREFIX}manage:someOrg`,
}

export const AppRoles = { ...BaseRoles, ...MetaRoles } as const;
export type AppRoles = BaseRoles | MetaRoles;
export const orgRoles = ["LEAD", "MEMBER"] as const;
export type OrgRole = typeof orgRoles[number];
export type OrgRoleDefinition = {
  org: typeof AllOrganizationNameList[number],
  role: OrgRole
}

export const allAppRoles = Object.values(BaseRoles).filter(
  (value) => typeof value === "string",
);

export const AppRoleHumanMapper: Record<AppRoles, string> = {
  [AppRoles.EVENTS_MANAGER]: "Events Manager",
  [AppRoles.TICKETS_SCANNER]: "Tickets Scanner",
  [AppRoles.TICKETS_MANAGER]: "Tickets Manager",
  [AppRoles.RSVPS_MANAGER]: "RSVPs Manager",
  [AppRoles.VIEW_RSVPS]: "RSVPs Viewer",
  [AppRoles.IAM_ADMIN]: "IAM Admin",
  [AppRoles.IAM_INVITE_ONLY]: "IAM Inviter",
  [AppRoles.LINKS_MANAGER]: "Links Manager",
  [AppRoles.LINKS_ADMIN]: "Links Admin",
  [AppRoles.STRIPE_LINK_CREATOR]: "Stripe Link Creator",
  [AppRoles.BYPASS_OBJECT_LEVEL_AUTH]: "Object Level Auth Bypass",
  [AppRoles.ROOM_REQUEST_CREATE]: "Room Request Creator",
  [AppRoles.ROOM_REQUEST_UPDATE]: "Room Request Updater",
  [AppRoles.AUDIT_LOG_VIEWER]: "Audit Log Viewer",
  [AppRoles.MANAGE_ORG_API_KEYS]: "Org API Keys Manager",
  [AppRoles.VIEW_INTERNAL_MEMBERSHIP_LIST]: "Internal Membership List Viewer",
  [AppRoles.VIEW_EXTERNAL_MEMBERSHIP_LIST]: "External Membership List Viewer",
  [AppRoles.MANAGE_EXTERNAL_MEMBERSHIP_LIST]: "External Membership List Manager",
  [AppRoles.ALL_ORG_MANAGER]: "Organization Definition Manager",
  [AppRoles.AT_LEAST_ONE_ORG_MANAGER]: "Manager of at least one org",
  [AppRoles.VIEW_USER_INFO]: "User Information Viewer"
}
