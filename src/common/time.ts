import { Temporal } from 'temporal-polyfill'

/**
 * Parses a date string in the specified timezone and returns a UTC Date.
 */
export function parseInTimezone(dateString: string, timezone: string): Date {
  let zonedDateTime: Temporal.ZonedDateTime;

  // If the string has a Z suffix or timezone offset, parse as an Instant
  if (dateString.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(dateString)) {
    const instant = Temporal.Instant.from(dateString);
    zonedDateTime = instant.toZonedDateTimeISO(timezone);
  } else {
    // Otherwise treat as a local datetime in the target timezone
    const plainDateTime = Temporal.PlainDateTime.from(dateString.replace(" ", "T"));
    zonedDateTime = plainDateTime.toZonedDateTime(timezone);
  }

  // Create a Date using the wall-clock time components in the target timezone
  // This "fakes" a Date that has the correct local time values when accessed via getHours(), etc.
  return new Date(
    zonedDateTime.year,
    zonedDateTime.month - 1, // JS months are 0-indexed
    zonedDateTime.day,
    zonedDateTime.hour,
    zonedDateTime.minute,
    zonedDateTime.second,
    zonedDateTime.millisecond
  );
}

/**
 * Formats a date string as YYYY-MM-DD in the specified timezone.
 */
export function formatDateInTimezone(dateString: string, timezone: string): string {
  const plainDateTime = Temporal.PlainDateTime.from(dateString.replace(" ", "T"));
  const zonedDateTime = plainDateTime.toZonedDateTime(timezone);
  return zonedDateTime.toPlainDate().toString();
}


/**
 * Applies the time component from a reference datetime to a date-only string.
 * Used for repeating event exclusions which are stored as dates but need times.
 */
export function applyTimeFromReference(
  dateString: string,
  referenceDateString: string,
  timezone: string,
): Date {
  const refPlain = Temporal.PlainDateTime.from(referenceDateString.replace(" ", "T"));
  const datePlain = Temporal.PlainDate.from(dateString);

  const combined = datePlain.toPlainDateTime({
    hour: refPlain.hour,
    minute: refPlain.minute,
    second: refPlain.second,
    millisecond: refPlain.millisecond,
  });

  const zoned = combined.toZonedDateTime(timezone);
  return new Date(zoned.epochMilliseconds);
}

// Example output: "January 7th 2026, 3:45:30 PM"
export function formatWithOrdinal(dateString: string, timezone: string): string {
  const date = parseInTimezone(dateString, timezone);

  const month = date.toLocaleString("en-US", { timeZone: timezone, month: "long" });
  const day = date.toLocaleString("en-US", { timeZone: timezone, day: "numeric" });
  const year = date.toLocaleString("en-US", { timeZone: timezone, year: "numeric" });
  const time = date.toLocaleString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  const dayNum = parseInt(day, 10);
  const ordinal =
    dayNum % 10 === 1 && dayNum !== 11 ? "st" :
      dayNum % 10 === 2 && dayNum !== 12 ? "nd" :
        dayNum % 10 === 3 && dayNum !== 13 ? "rd" : "th";

  return `${month} ${dayNum}${ordinal} ${year}, ${time}`;
}

export function fromNow(dateString: string, timezone: string): string {
  const date = parseInTimezone(dateString, timezone);
  const now = Date.now();
  const diffMs = now - date.getTime();
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
