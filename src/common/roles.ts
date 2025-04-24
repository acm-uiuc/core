/* eslint-disable import/prefer-default-export */
export const runEnvironments = ["dev", "prod"] as const;
export type RunEnvironment = (typeof runEnvironments)[number];
export enum AppRoles {
  EVENTS_MANAGER = "manage:events",
  SIGLEAD_MANAGER = "manage:siglead",
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
  MANAGE_ORG_API_KEYS = "manage:orgApiKey"
}
export const allAppRoles = Object.values(AppRoles).filter(
  (value) => typeof value === "string",
);
