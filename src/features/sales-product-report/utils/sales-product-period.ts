/**
 * Local-timezone period bounds for get_sales_by_product.
 *
 * The RPC takes timestamptz. Day / week edges are computed here so SQL
 * never date_trunc(now()) in UTC.
 */

import type { Shift } from "@/features/shifts/types/shift";
import type {
  SalesByProductPeriod,
  SalesByProductPreset,
} from "../types/sales-product-report";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function formatLocalDateInput(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfLocalDay(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0,
  );
}

export function endOfLocalDay(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  );
}

export function startOfLocalWeekMonday(date: Date): Date {
  const day = date.getDay();
  const offset = day === 0 ? 6 : day - 1;
  return startOfLocalDay(
    new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset),
  );
}

function parseDateOnly(value: string): Date | null {
  const trimmed = value.trim();
  if (!DATE_ONLY.test(trimmed)) {
    return null;
  }
  const parsed = new Date(`${trimmed}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

export function resolveSalesByProductPeriod(input: {
  preset: SalesByProductPreset;
  now?: Date;
  shift: Shift | null;
  customFrom: string;
  customTo: string;
}): { data: SalesByProductPeriod | null; error: string | null } {
  const now = input.now ?? new Date();

  if (input.preset === "today") {
    return {
      data: {
        from: startOfLocalDay(now).toISOString(),
        to: endOfLocalDay(now).toISOString(),
      },
      error: null,
    };
  }

  if (input.preset === "this_week") {
    return {
      data: {
        from: startOfLocalWeekMonday(now).toISOString(),
        to: now.toISOString(),
      },
      error: null,
    };
  }

  if (input.preset === "this_shift") {
    if (!input.shift) {
      return { data: null, error: "No shift is available for this period." };
    }
    if (input.shift.status === "open") {
      return {
        data: {
          from: input.shift.opened_at,
          to: now.toISOString(),
        },
        error: null,
      };
    }
    if (input.shift.status === "closed" && input.shift.closed_at) {
      return {
        data: {
          from: input.shift.opened_at,
          to: input.shift.closed_at,
        },
        error: null,
      };
    }
    return { data: null, error: "No shift is available for this period." };
  }

  const fromDate = parseDateOnly(input.customFrom);
  const toDate = parseDateOnly(input.customTo);
  if (!fromDate || !toDate) {
    return { data: null, error: "Enter a valid start and end date." };
  }
  const from = startOfLocalDay(fromDate);
  const to = endOfLocalDay(toDate);
  if (from.getTime() > to.getTime()) {
    return { data: null, error: "Start date must be on or before end date." };
  }

  return {
    data: {
      from: from.toISOString(),
      to: to.toISOString(),
    },
    error: null,
  };
}
