export enum Modules {
  IAM = "iam",
  EVENTS = "events",
  STRIPE = "stripe",
  TICKETS = "tickets",
  EMAIL_NOTIFICATION = "emailNotification",
  PROVISION_NEW_MEMBER = "provisionNewMember",
  MOBILE_WALLET = "mobileWallet",
  LINKRY = "linkry",
  AUDIT_LOG = "auditLog",
  API_KEY = "apiKey",
  ROOM_RESERVATIONS = "roomReservations",
  EXTERNAL_MEMBERSHIP = "externalMembership",
  ORG_INFO = "orgInfo"
}


export const ModulesToHumanName: Record<Modules, string> = {
  [Modules.IAM]: "IAM",
  [Modules.EVENTS]: "Events",
  [Modules.STRIPE]: "Stripe Integration",
  [Modules.TICKETS]: "Ticketing/Merch",
  [Modules.EMAIL_NOTIFICATION]: "Email Notifications",
  [Modules.PROVISION_NEW_MEMBER]: "Member Provisioning",
  [Modules.MOBILE_WALLET]: "Mobile Wallet",
  [Modules.LINKRY]: "Link Shortener",
  [Modules.AUDIT_LOG]: "Audit Log",
  [Modules.API_KEY]: "API Keys",
  [Modules.ROOM_RESERVATIONS]: "Room Reservations",
  [Modules.EXTERNAL_MEMBERSHIP]: "External Membership",
  [Modules.ORG_INFO]: "Organization Info & Leads",
}
