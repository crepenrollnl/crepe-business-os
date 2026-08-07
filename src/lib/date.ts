import { DEFAULT_LOCALE } from "@/constants/config";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parsing a bare "YYYY-MM-DD" string with `new Date()` treats it as UTC
 * midnight, which can shift the displayed calendar day for users west of
 * UTC. Force local-time parsing for date-only input; full ISO timestamps
 * parse as-is.
 */
function toSafeDate(value: string | Date): Date {
  if (value instanceof Date) {
    return value;
  }
  return DATE_ONLY_PATTERN.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
}

const dateFormatter = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const monthYearFormatter = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
  month: "short",
  year: "numeric",
});

/** Display-only date formatting, e.g. "30 Jul 2026". Returns "—" for missing/invalid input. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) {
    return "—";
  }

  const date = toSafeDate(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return dateFormatter.format(date);
}

/** Display-only date+time formatting, e.g. "30 Jul 2026, 13:35". Returns "—" for missing/invalid input. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) {
    return "—";
  }

  const date = toSafeDate(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return dateTimeFormatter.format(date);
}

/** Display-only month+year formatting, e.g. "Jun 2026". Returns "—" for missing/invalid input. */
export function formatMonthYear(value: string | Date | null | undefined): string {
  if (!value) {
    return "—";
  }

  const date = toSafeDate(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return monthYearFormatter.format(date);
}
