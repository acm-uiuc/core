/* eslint-disable import/prefer-default-export */
export const runEnvironments = ["dev", "prod"] as const;
export type RunEnvironment = (typeof runEnvironments)[number];
export enum AppRoles {
  EVENTS_MANAGER = "manage:events",
  TICKETS_SCANNER = "scan:tickets",
  TICKETS_MANAGER = "manage:tickets",
  IAM_ADMIN = "admin:iam",
  IAM_INVITE_ONLY = "invite:iam",
  STRIPE_LINK_CREATOR = "create:stripeLink",
  BYPASS_OBJECT_LEVEL_AUTH = "bypass:ola",
}
export const allAppRoles = Object.values(AppRoles).filter(
  (value) => typeof value === "string",
);
