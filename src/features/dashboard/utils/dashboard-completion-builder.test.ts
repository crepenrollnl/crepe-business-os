/**
 * Pure builder coverage for Dashboard Completion (Dashboard redesign — 3 blocks).
 */

import { describe, expect, it } from "vitest";
import type { DashboardCompletionModel } from "../types/dashboard-completion";
import type { DashboardReadModel } from "../types/dashboard-read-model";
import {
  assertDashboardCompletionHistoricallyConsistent,
  buildDashboardCompletion,
} from "./dashboard-completion-builder";

const SHIFT_OPEN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHIFT_CLOSED_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FLOUR_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

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

function fullClosedReadModel(): DashboardReadModel {
  return emptyReadModel({
    latest_closed_shift: {
      id: SHIFT_CLOSED_ID,
      opened_at: "2026-07-26T08:00:00.000Z",
      closed_at: "2026-07-26T20:00:00.000Z",
      status: "closed",
      notes: null,
      created_at: "2026-07-26T08:00:00.000Z",
    },
    daily_sales_summary: {
      id: "sales-1",
      shift_id: SHIFT_CLOSED_ID,
      sales_count: 5,
      items_sold: 10,
      gross_revenue: 120,
      net_revenue: 100,
      average_receipt: 20,
      generated_at: "2026-07-26T20:00:00.000Z",
      created_at: "2026-07-26T20:00:00.000Z",
    },
    daily_profit_summary: {
      id: "profit-1",
      shift_id: SHIFT_CLOSED_ID,
      net_revenue: 100,
      total_cogs: 40,
      gross_profit: 60,
      gross_margin_percent: 60,
      generated_at: "2026-07-26T20:00:00.000Z",
      created_at: "2026-07-26T20:00:00.000Z",
    },
    cash_reconciliation: {
      id: "recon-1",
      shift_id: SHIFT_CLOSED_ID,
      expected_cash: 100,
      counted_cash: 100,
      difference: 0,
      notes: null,
      reconciled_at: "2026-07-26T20:05:00.000Z",
      created_at: "2026-07-26T20:05:00.000Z",
    },
    low_stock_alerts: [
      {
        ingredient_id: FLOUR_ID,
        ingredient_name: "Flour",
        unit: "kg",
        alert_level: "critical",
        current_quantity: 2,
        days_remaining: 1,
        recommended_quantity: 26,
        alert_reason: "Forecast is critical; replenish to target stock.",
      },
    ],
    kpi_summary: {
      total_inventory_value: 1000,
      inventory_items_below_minimum: 1,
      finished_goods_available: 10,
      total_sales_count: 5,
      total_purchase_count: 2,
      active_customers_count: 3,
      active_suppliers_count: 4,
      low_stock_items: 1,
      out_of_stock_items: 0,
      batches_in_progress: 0,
      finished_batches_today: 0,
      draft_sales_count: 0,
      confirmed_sales_today: 5,
      draft_purchase_count: 0,
      completed_purchases_today: 1,
      last_inventory_movement_at: null,
      last_sale_at: null,
      last_purchase_at: null,
    },
  });
}

describe("dashboard-completion-builder", () => {
  it("builds a full dashboard completion view", () => {
    const result = buildDashboardCompletion(fullClosedReadModel());

    expect(result.error).toBeNull();
    expect(result.data?.money_today.source).toBe("closed_shift_summary");
    expect(result.data?.money_today.revenue.display_value).toBe("€120.00");
    expect(result.data?.money_today.profit.display_value).toBe("€60.00");
    expect(result.data?.low_stock_alerts).toHaveLength(1);
    expect(result.data?.informational_messages).toEqual([]);
  });

  it("builds an empty / no-shift dashboard without duplicated module ownership messages", () => {
    const result = buildDashboardCompletion(emptyReadModel());

    expect(result.error).toBeNull();
    expect(result.data?.money_today.source).toBe("unavailable");
    expect(result.data?.low_stock_alerts).toBeNull();
    // Shift / inventory ownership is not duplicated in dashboard info.
    expect(result.data?.informational_messages.join(" ")).not.toMatch(
      /No shift is available/i,
    );
    expect(result.data?.informational_messages.join(" ")).not.toMatch(
      /Low stock alerts are unavailable/i,
    );
    expect(result.data?.informational_messages.join(" ")).toMatch(
      /overview metrics/i,
    );
  });

  it("builds a partial dashboard for an active shift without summaries", () => {
    const result = buildDashboardCompletion(
      emptyReadModel({
        current_shift: {
          id: SHIFT_OPEN_ID,
          opened_at: "2026-07-27T08:00:00.000Z",
          closed_at: null,
          status: "open",
          notes: null,
          created_at: "2026-07-27T08:00:00.000Z",
        },
        low_stock_alerts: [],
        kpi_summary: null,
      }),
    );

    expect(result.data?.money_today.source).toBe("pending");
    expect(result.data?.money_today.revenue.availability).toBe("missing");
    expect(result.data?.money_today.profit.availability).toBe("missing");
    expect(result.data?.low_stock_alerts).toEqual([]);
    expect(result.data?.informational_messages.join(" ")).toMatch(
      /overview metrics/i,
    );
  });

  it("surfaces a single user-facing notice for missing closed-shift summaries", () => {
    const result = buildDashboardCompletion(
      emptyReadModel({
        latest_closed_shift: {
          id: SHIFT_CLOSED_ID,
          opened_at: "2026-07-26T08:00:00.000Z",
          closed_at: "2026-07-26T20:00:00.000Z",
          status: "closed",
          notes: null,
          created_at: "2026-07-26T08:00:00.000Z",
        },
        low_stock_alerts: [],
      }),
    );

    const messages = result.data?.informational_messages ?? [];
    expect(messages).toHaveLength(2);
    expect(messages.join(" ")).toMatch(/daily close summaries/i);
    expect(messages.join(" ")).toMatch(/overview metrics/i);
    expect(messages.join(" ")).not.toMatch(/Foundation KPI row/i);

    // Money Today reflects the same "figures pending" gap.
    expect(result.data?.money_today.source).toBe("pending");
  });

  it("asserts historical consistency for identical read models", () => {
    const readModel = fullClosedReadModel();
    const first = buildDashboardCompletion(readModel);
    const second = buildDashboardCompletion({ ...readModel });

    expect(
      assertDashboardCompletionHistoricallyConsistent({
        previous: first.data as DashboardCompletionModel,
        next: second.data as DashboardCompletionModel,
      }),
    ).toBeNull();
  });
});
