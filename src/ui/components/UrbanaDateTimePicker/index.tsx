import React from "react";
import { DateTimePicker, DateTimePickerProps } from "@mantine/dates";
import { Temporal } from "temporal-polyfill";

const CHICAGO_TZ = "America/Chicago";

interface UrbanaDateTimePickerProps extends Omit<
  DateTimePickerProps,
  "value" | "onChange"
> {
  /** Unix timestamp in seconds (UTC) */
  value: number | undefined;
  /** Callback with unix timestamp in seconds (UTC) */
  onChange: (value: number | undefined) => void;
}

/**
 * Converts a UTC unix timestamp to a Date that displays Chicago time in the picker.
 */
export const utcUnixToChicagoDisplayDate = (
  unix: number | undefined,
): Date | null => {
  if (unix == null) {
    return null;
  }

  const instant = Temporal.Instant.fromEpochMilliseconds(unix * 1000);
  const chicagoTime = instant.toZonedDateTimeISO(CHICAGO_TZ);

  return new Date(
    chicagoTime.year,
    chicagoTime.month - 1,
    chicagoTime.day,
    chicagoTime.hour,
    chicagoTime.minute,
    chicagoTime.second,
  );
};

/**
 * Formats a UTC unix timestamp as a Chicago time string.
 */
export const formatChicagoTime = (
  unix: number | undefined | null,
  options?: Intl.DateTimeFormatOptions,
): string => {
  if (unix == null) {
    return "—";
  }

  const defaultOptions: Intl.DateTimeFormatOptions = {
    timeZone: CHICAGO_TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };

  const date = new Date(unix * 1000);
  return `${date.toLocaleString("en-US", options ?? defaultOptions)} CT`;
};

/**
 * Converts a Date or string from the picker (representing Chicago time) to UTC unix timestamp.
 */
export const chicagoDisplayDateToUtcUnix = (
  date: Date | string | null,
): number | undefined => {
  if (date == null) {
    return undefined;
  }

  const d = typeof date === "string" ? new Date(date) : date;

  if (isNaN(d.getTime())) {
    return undefined;
  }

  const chicagoTime = Temporal.ZonedDateTime.from({
    timeZone: CHICAGO_TZ,
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    second: d.getSeconds(),
  });

  return Math.floor(chicagoTime.epochMilliseconds / 1000);
};

/**
 * A DateTimePicker that always displays and resolves times in America/Chicago timezone.
 * Accepts and returns UTC unix timestamps in seconds.
 */
export const UrbanaDateTimePicker: React.FC<UrbanaDateTimePickerProps> = ({
  value,
  onChange,
  ...props
}) => {
  const displayDate = utcUnixToChicagoDisplayDate(value);

  const handleChange = (newValue: string | Date | null) => {
    const unix = chicagoDisplayDateToUtcUnix(newValue);
    onChange(unix);
  };

  return (
    <DateTimePicker
      key={value}
      value={displayDate}
      onChange={handleChange}
      firstDayOfWeek={0}
      timePickerProps={{
        withDropdown: true,
        popoverProps: { withinPortal: false },
        format: "12h",
      }}
      {...props}
    />
  );
};
