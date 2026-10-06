import { describe, expect, it } from "vitest";
import { addCalendarDays, amsterdamToday } from "./amsterdam-date";

describe("amsterdamToday", () => {
  it("uses the Amsterdam calendar date when UTC is still the previous day", () => {
    expect(amsterdamToday(new Date("2026-10-05T23:30:00.000Z"))).toBe(
      "2026-10-06",
    );
  });

  it("keeps the same calendar date in the Amsterdam afternoon", () => {
    expect(amsterdamToday(new Date("2026-10-05T12:00:00.000Z"))).toBe(
      "2026-10-05",
    );
  });
});

describe("addCalendarDays", () => {
  it("subtracts 60 calendar days", () => {
    expect(addCalendarDays("2026-10-05", -60)).toBe("2026-08-06");
  });
});
