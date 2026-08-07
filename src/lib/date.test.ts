import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatMonthYear } from "./date";

describe("formatDate", () => {
  it("formats a full ISO timestamp", () => {
    expect(formatDate("2026-07-30T11:35:28.023Z")).toBe("30 Jul 2026");
  });

  it("formats a date-only string without shifting to the previous day", () => {
    expect(formatDate("2026-08-05")).toBe("5 Aug 2026");
  });

  it("accepts a Date instance", () => {
    expect(formatDate(new Date("2026-01-01T00:00:00"))).toBe("1 Jan 2026");
  });

  it("returns an em dash for null, undefined, and invalid input", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("formats date and time together", () => {
    // Hour/minute depend on the machine's local timezone — assert shape, not the wall-clock value.
    expect(formatDateTime("2026-07-26T14:30:00.000Z")).toMatch(
      /^26 Jul 2026, \d{2}:\d{2}$/,
    );
  });

  it("returns an em dash for missing input", () => {
    expect(formatDateTime(null)).toBe("—");
  });
});

describe("formatMonthYear", () => {
  it("formats month and year only, dropping the day", () => {
    expect(formatMonthYear("2026-06-15")).toBe("Jun 2026");
  });

  it("returns an em dash for missing input", () => {
    expect(formatMonthYear(undefined)).toBe("—");
  });
});
