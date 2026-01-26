export const STRIPE_LINK_RETENTION_DAYS = 90; // this number of days after the link is deactivated.
export const AUDIT_LOG_RETENTION_DAYS = 365;
export const ROOM_RESERVATION_RETENTION_DAYS = 1460;
export const UIN_RETENTION_DAYS = 365;
export const FULFILLED_PURCHASES_RETENTION_DAYS = 1460; // ticketing/merch: after the purchase is marked as fulfilled.
export const EVENTS_EXPIRY_AFTER_LAST_OCCURRENCE_DAYS = 1460; // hold events for 4 years after last occurrence
export const UPLOAD_GRACE_PERIOD_MS = 30 * 60 * 1000; // 30 minutes
export const DEFAULT_TIMEZONE = "America/Chicago";
export const AUTH_CACHE_PREFIX = `authCache:`;
export const FIRST_VALID_EPOCH_TS = 1659330000; // Aug 1 2022 00:00 CT
// we keep data longer for historical analytics purposes in S3 as needed
