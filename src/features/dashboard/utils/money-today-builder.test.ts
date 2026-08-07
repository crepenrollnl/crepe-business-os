/**
 * Pure builder coverage for Money Today (Dashboard redesign — Block 2).
 */

import { describe, expect, it } from "vitest";
import type { DashboardReadModel } from "../types/dashboard-read-model";
import {
  buildMoneyToday,
  buildMoneyTodayFromReadModel,
} from "./money-today-builder";

const SHIFT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function emptyReadModel(
  overrides?: Partial<DashboardReadModel>,
): DashboardReadModel {
  return {
    current_shift: null,
    latest_closed_shift: null,
    daily_sales_summary: null,
    daily_profit_summary: null,
    cash_reconciliation: null,
    low_stock_alerts: null,
    kpi_summary: null,
    ...overrides,
  };
}

function byId(model: ReturnType<typeof buildMoneyToday>["data"]) {
  return Object.fromEntries(model.details.map((field) => [field.id, field]));
}

describe("money-today-builder", () => {
  it("shows 'No shift data yet' and missing fields when no shift has ever existed", () => {
    const result = buildMoneyToday({
      current_shift: null,
      latest_closed_shift: null,
      daily_sales_summary: null,
      daily_profit_summary: null,
    });

    expect(result.error).toBeNull();
    expect(result.data.source).toBe("unavailable");
    expect(result.data.source_label).toBe("No shift data yet.");
    expect(result.data.revenue).toMatchObject({
      display_value: "—",
      availability: "missing",
    });
    expect(result.data.profit).toMatchObject({
      display_value: "—",
      availability: "missing",
    });
    for (const field of result.data.details) {
      expect(field.availability).toBe("missing");
      expect(field.display_value).toBe("—");
    }
  });

  it("shows a pending state while a shift is currently open", () => {
    const result = buildMoneyToday({
      current_shift: { id: SHIFT_ID },
      latest_closed_shift: null,
      daily_sales_summary: null,
      daily_profit_summary: null,
    });

    expect(result.data.source).toBe("pending");
    expect(result.data.source_label).toBe(
      "Shift not closed yet — figures pending.",
    );
    expect(result.data.revenue.availability).toBe("missing");
    expect(result.data.profit.availability).toBe("missing");
  });

  it("shows a pending state when the latest shift is closed but summaries are not generated yet", () => {
    const result = buildMoneyToday({
      current_shift: null,
      latest_closed_shift: { id: SHIFT_ID },
      daily_sales_summary: null,
      daily_profit_summary: null,
    });

    expect(result.data.source).toBe("pending");
    expect(result.data.source_label).toBe("Shift closed — figures pending.");
    expect(result.data.revenue.availability).toBe("missing");
    expect(result.data.profit.availability).toBe("missing");
  });

  it("builds Revenue, Profit, and all detail fields from the frozen daily summaries", () => {
    const result = buildMoneyToday({
      current_shift: null,
      latest_closed_shift: { id: SHIFT_ID },
      daily_sales_summary: {
        sales_count: 6,
        items_sold: 9,
        gross_revenue: 145.5,
        net_revenue: 120.25,
      },
      daily_profit_summary: {
        gross_profit: 80.25,
        total_cogs: 40,
        gross_margin_percent: 66.666,
      },
    });

    expect(result.data.source).toBe("closed_shift_summary");
    expect(result.data.source_label).toBe(
      "From the last closed shift's summary.",
    );
    expect(result.data.revenue).toMatchObject({
      display_value: "€145.50",
      availability: "available",
    });
    expect(result.data.profit).toMatchObject({
      display_value: "€80.25",
      availability: "available",
    });

    const details = byId(result.data);
    expect(details.sales_count).toMatchObject({
      display_value: "6",
      availability: "available",
    });
    expect(details.items_sold).toMatchObject({
      display_value: "9",
      availability: "available",
    });
    expect(details.net_revenue).toMatchObject({
      display_value: "€120.25",
      availability: "available",
    });
    expect(details.total_cogs).toMatchObject({
      display_value: "€40.00",
      availability: "available",
    });
    expect(details.gross_margin_percent).toMatchObject({
      display_value: "66.67%",
      availability: "available",
    });
  });

  it("formats a fractional items-sold count without a trailing zero", () => {
    const result = buildMoneyToday({
      current_shift: null,
      latest_closed_shift: { id: SHIFT_ID },
      daily_sales_summary: {
        sales_count: 3,
        items_sold: 4.5,
        gross_revenue: 60,
        net_revenue: 50,
      },
      daily_profit_summary: null,
    });

    expect(byId(result.data).items_sold?.display_value).toBe("4.5");
  });

  it("shows a dash for gross margin percent when it is null", () => {
    const result = buildMoneyToday({
      current_shift: null,
      latest_closed_shift: { id: SHIFT_ID },
      daily_sales_summary: null,
      daily_profit_summary: {
        gross_profit: 0,
        total_cogs: 0,
        gross_margin_percent: null,
      },
    });

    expect(byId(result.data).gross_margin_percent?.display_value).toBe("—");
  });

  it("keeps sales fields available and profit fields missing when only the sales summary exists", () => {
    const result = buildMoneyToday({
      current_shift: null,
      latest_closed_shift: { id: SHIFT_ID },
      daily_sales_summary: {
        sales_count: 2,
        items_sold: 3,
        gross_revenue: 40,
        net_revenue: 35,
      },
      daily_profit_summary: null,
    });

    // Missing the profit summary keeps the whole block "pending" — revenue
    // and profit headline figures are shown together or not at all.
    expect(result.data.source).toBe("pending");
    expect(result.data.revenue.availability).toBe("available");
    expect(result.data.profit.availability).toBe("missing");

    const details = byId(result.data);
    expect(details.sales_count?.availability).toBe("available");
    expect(details.total_cogs?.availability).toBe("missing");
    expect(details.gross_margin_percent?.availability).toBe("missing");
  });

  it("projects from a full DashboardReadModel", () => {
    const result = buildMoneyTodayFromReadModel(
      emptyReadModel({
        latest_closed_shift: {
          id: SHIFT_ID,
          opened_at: "2026-07-26T08:00:00.000Z",
          closed_at: "2026-07-26T20:00:00.000Z",
          status: "closed",
          notes: null,
          created_at: "2026-07-26T08:00:00.000Z",
        },
        daily_sales_summary: {
          id: "sales-1",
          shift_id: SHIFT_ID,
          sales_count: 3,
          items_sold: 6,
          gross_revenue: 90,
          net_revenue: 75,
          average_receipt: 30,
          generated_at: "2026-07-26T20:00:00.000Z",
          created_at: "2026-07-26T20:00:00.000Z",
        },
        daily_profit_summary: {
          id: "profit-1",
          shift_id: SHIFT_ID,
          net_revenue: 75,
          total_cogs: 30,
          gross_profit: 45,
          gross_margin_percent: 60,
          generated_at: "2026-07-26T20:00:00.000Z",
          created_at: "2026-07-26T20:00:00.000Z",
        },
      }),
    );

    expect(result.data.source).toBe("closed_shift_summary");
    expect(result.data.revenue.display_value).toBe("€90.00");
    expect(result.data.profit.display_value).toBe("€45.00");
    expect(byId(result.data).gross_margin_percent?.display_value).toBe(
      "60.00%",
    );
  });

  it("does not require summaries when a shift is open in the full read model", () => {
    const result = buildMoneyTodayFromReadModel(
      emptyReadModel({
        current_shift: {
          id: SHIFT_ID,
          opened_at: "2026-07-27T08:00:00.000Z",
          closed_at: null,
          status: "open",
          notes: null,
          created_at: "2026-07-27T08:00:00.000Z",
        },
      }),
    );

    expect(result.data.source).toBe("pending");
    expect(result.data.revenue.availability).toBe("missing");
  });
});
