import { Temporal } from 'temporal-polyfill'
import { DEFAULT_TIMEZONE } from './constants.js';

/**
 * Parses a datetime string into a ZonedDateTime in the specified timezone.
 * Handles both UTC strings (with Z suffix or offset) and naive datetime strings.
 */
function toZonedDateTime(dateString: string, timezone: string): Temporal.ZonedDateTime {
  const isoString = dateString.replace(" ", "T");

  if (isoString.endsWith("Z")) {
    return Temporal.Instant.from(isoString).toZonedDateTimeISO(timezone);
  }

  const plainDateTime = Temporal.PlainDateTime.from(isoString);
  return plainDateTime.toZonedDateTime(timezone);
}

/**
 * Parses a date string and returns a Date representing the instant in time.
 */
export function parseInTimezone(dateString: string, targetTimezone: string): Date {
  const isoString = dateString.replace(" ", "T");
  let plainDateTime: Temporal.PlainDateTime;

  if (isoString.endsWith("Z")) {
    plainDateTime = Temporal.Instant.from(isoString)
      .toZonedDateTimeISO(targetTimezone)
      .toPlainDateTime();
  } else {
    plainDateTime = Temporal.PlainDateTime.from(isoString);
  }

  const zonedDateTime = plainDateTime.toZonedDateTime(targetTimezone);

  return new Date(zonedDateTime.epochMilliseconds);
}

/**
 * Formats a date string as YYYY-MM-DD in the specified timezone.
 */
export function formatDateInTimezone(dateString: string, timezone: string): string {
  const zonedDateTime = toZonedDateTime(dateString, timezone);
  return zonedDateTime.toPlainDate().toString();
}

/**
 * Applies the time component from a reference datetime to a date-only string.
 * Used for repeating event exclusions which are stored as dates but need times.
 *
 * IMPORTANT: This extracts the literal wall-clock time (e.g., "14:30") from the
 * reference and applies it to the target date, preserving that wall-clock time
 * in the target timezone.
 */
export function applyTimeFromReference(
  dateString: string,
  referenceDateString: string,
  timezone: string,
): Date {
  const refZoned = toZonedDateTime(referenceDateString, timezone);
  const datePlain = Temporal.PlainDate.from(dateString);

  const combined = datePlain.toPlainDateTime({
    hour: refZoned.hour,
    minute: refZoned.minute,
    second: refZoned.second,
    millisecond: refZoned.millisecond,
  });

  const zonedDateTime = combined.toZonedDateTime(timezone);
  return new Date(zonedDateTime.epochMilliseconds);
}

// Example output: "January 7th 2026, 3:45:30 PM"
export function formatWithOrdinal(dateString: string, timezone: string): string {
  const zonedDateTime = toZonedDateTime(dateString, timezone);

  const month = zonedDateTime.toLocaleString("en-US", { month: "long" });
  const day = zonedDateTime.day;
  const year = zonedDateTime.year;
  const time = zonedDateTime.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  const ordinal =
    day % 10 === 1 && day !== 11 ? "st" :
      day % 10 === 2 && day !== 12 ? "nd" :
        day % 10 === 3 && day !== 13 ? "rd" : "th";

  return `${month} ${day}${ordinal} ${year}, ${time}`;
}

export function fromNow(dateString: string, timezone: string): string {
  const zonedDateTime = toZonedDateTime(dateString, timezone);
  const now = Date.now();
  const diffMs = now - zonedDateTime.epochMilliseconds;
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHr = Math.round(diffMin / 60);
  const diffDays = Math.round(diffHr / 24);
  const diffMonths = Math.round(diffDays / 30);
  const diffYears = Math.round(diffDays / 365);

  const isFuture = diffMs < 0;
  const abs = (n: number) => Math.abs(n);

  const format = (value: number, unit: string) => {
    const v = abs(value);
    const u = v === 1 ? unit : `${unit}s`;
    return isFuture ? `in ${v} ${u}` : `${v} ${u} ago`;
  };

  if (abs(diffSec) < 45) return isFuture ? "in a few seconds" : "a few seconds ago";
  if (abs(diffMin) < 2) return isFuture ? "in a minute" : "a minute ago";
  if (abs(diffMin) < 45) return format(diffMin, "minute");
  if (abs(diffHr) < 2) return isFuture ? "in an hour" : "an hour ago";
  if (abs(diffHr) < 22) return format(diffHr, "hour");
  if (abs(diffDays) < 2) return isFuture ? "in a day" : "a day ago";
  if (abs(diffDays) < 26) return format(diffDays, "day");
  if (abs(diffMonths) < 2) return isFuture ? "in a month" : "a month ago";
  if (abs(diffMonths) < 11) return format(diffMonths, "month");
  if (abs(diffYears) < 2) return isFuture ? "in a year" : "a year ago";
  return format(diffYears, "year");
}

export const isInDefaultTimezone = () => {
  return Intl.DateTimeFormat().resolvedOptions().timeZone === DEFAULT_TIMEZONE
}

export const currentTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

export function getCurrentTimezoneShortCode() {
  const date = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZoneName: 'short'
  }).formatToParts(date);

  const timeZoneNamePart = parts.find(part => part.type === 'timeZoneName');
  return timeZoneNamePart ? timeZoneNamePart.value : 'N/A';
}

export function parseAsLocalDate(dateString: string, targetTimezone: string): Date {
  const isoString = dateString.replace(" ", "T");

  let plainDateTime: Temporal.PlainDateTime;

  if (isoString.endsWith("Z")) {
    plainDateTime = Temporal.Instant.from(isoString)
      .toZonedDateTimeISO(targetTimezone)
      .toPlainDateTime();
  } else {
    plainDateTime = Temporal.PlainDateTime.from(isoString);
  }

  return new Date(
    plainDateTime.year,
    plainDateTime.month - 1,
    plainDateTime.day,
    plainDateTime.hour,
    plainDateTime.minute,
    plainDateTime.second,
    plainDateTime.millisecond
  );
}


export function applyTimeFromReferenceAsLocal(
  dateString: string,
  referenceDateString: string,
  timezone: string,
): Date {
  const refZoned = toZonedDateTime(referenceDateString, timezone);
  const datePlain = Temporal.PlainDate.from(dateString);

  const combined = datePlain.toPlainDateTime({
    hour: refZoned.hour,
    minute: refZoned.minute,
    second: refZoned.second,
    millisecond: refZoned.millisecond,
  });

  return new Date(
    combined.year,
    combined.month - 1,
    combined.day,
    combined.hour,
    combined.minute,
    combined.second,
    combined.millisecond
  );
}
