/**
 * Period bound coverage for Sales by Product (local TZ, not UTC date_trunc).
 */

import { describe, expect, it } from "vitest";
import type { Shift } from "@/features/shifts/types/shift";
import {
  endOfLocalDay,
  resolveSalesByProductPeriod,
  startOfLocalDay,
  startOfLocalWeekMonday,
} from "./sales-product-period";

const SHIFT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function openShift(): Shift {
  return {
    id: SHIFT_ID,
    opened_at: "2026-08-29T09:23:00.000Z",
    closed_at: null,
    status: "open",
    notes: null,
    created_at: "2026-08-29T09:23:00.000Z",
  };
}

function closedShift(): Shift {
  return {
    id: SHIFT_ID,
    opened_at: "2026-08-29T09:23:00.000Z",
    closed_at: "2026-08-29T13:30:00.000Z",
    status: "closed",
    notes: null,
    created_at: "2026-08-29T09:23:00.000Z",
  };
}

describe("sales-product-period", () => {
  it("uses local midnight-to-end for today", () => {
    const now = new Date(2026, 7, 30, 21, 5, 0);
    const result = resolveSalesByProductPeriod({
      preset: "today",
      now,
      shift: null,
      customFrom: "",
      customTo: "",
    });

    expect(result.error).toBeNull();
    expect(result.data?.from).toBe(startOfLocalDay(now).toISOString());
    expect(result.data?.to).toBe(endOfLocalDay(now).toISOString());
  });

  it("starts this week on local Monday", () => {
    const sunday = new Date(2026, 7, 30, 12, 0, 0);
    const result = resolveSalesByProductPeriod({
      preset: "this_week",
      now: sunday,
      shift: null,
      customFrom: "",
      customTo: "",
    });

    expect(result.error).toBeNull();
    expect(result.data?.from).toBe(startOfLocalWeekMonday(sunday).toISOString());
    expect(startOfLocalWeekMonday(sunday).getDay()).toBe(1);
    expect(result.data?.to).toBe(sunday.toISOString());
  });

  it("uses the open shift window through now", () => {
    const now = new Date("2026-08-29T12:00:00.000Z");
    const result = resolveSalesByProductPeriod({
      preset: "this_shift",
      now,
      shift: openShift(),
      customFrom: "",
      customTo: "",
    });

    expect(result.error).toBeNull();
    expect(result.data?.from).toBe("2026-08-29T09:23:00.000Z");
    expect(result.data?.to).toBe(now.toISOString());
  });

  it("uses opened_at/closed_at for a closed shift", () => {
    const result = resolveSalesByProductPeriod({
      preset: "this_shift",
      now: new Date("2026-08-30T10:00:00.000Z"),
      shift: closedShift(),
      customFrom: "",
      customTo: "",
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      from: "2026-08-29T09:23:00.000Z",
      to: "2026-08-29T13:30:00.000Z",
    });
  });

  it("rejects this_shift when no shift exists", () => {
    const result = resolveSalesByProductPeriod({
      preset: "this_shift",
      shift: null,
      customFrom: "",
      customTo: "",
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe("No shift is available for this period.");
  });

  it("maps a custom local date range to inclusive day bounds", () => {
    const result = resolveSalesByProductPeriod({
      preset: "custom",
      shift: null,
      customFrom: "2026-08-29",
      customTo: "2026-08-29",
    });

    expect(result.error).toBeNull();
    const from = new Date("2026-08-29T00:00:00");
    const to = new Date("2026-08-29T23:59:59.999");
    expect(result.data?.from).toBe(from.toISOString());
    expect(result.data?.to).toBe(to.toISOString());
  });

  it("rejects a custom range that starts after it ends", () => {
    const result = resolveSalesByProductPeriod({
      preset: "custom",
      shift: null,
      customFrom: "2026-08-30",
      customTo: "2026-08-29",
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe("Start date must be on or before end date.");
  });
});
