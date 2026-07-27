/**
 * Pure builder coverage for Dashboard Read Model (DEV-122).
 */

import { describe, expect, it } from "vitest";
import type { DashboardReadModel } from "../types/dashboard-read-model";
import type { DashboardSummary } from "../types/dashboard";
import type { CashReconciliation } from "@/features/shifts/types/cash-reconciliation";
import type { DailyProfitSummary } from "@/features/shifts/types/daily-profit-summary";
import type { DailySalesSummary } from "@/features/shifts/types/daily-sales-summary";
import type { Shift } from "@/features/shifts/types/shift";
import type { LowStockAlert } from "@/features/inventory/types/low-stock-alert";
import {
  assertDashboardReadModelHistoricallyConsistent,
  buildDashboardReadModel,
} from "./dashboard-read-model-builder";

const SHIFT_OPEN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHIFT_CLOSED_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function openShift(overrides?: Partial<Shift>): Shift {
  return {
    id: SHIFT_OPEN_ID,
    opened_at: "2026-07-27T08:00:00.000Z",
    closed_at: null,
    status: "open",
    notes: null,
    created_at: "2026-07-27T08:00:00.000Z",
    ...overrides,
  };
}

function closedShift(overrides?: Partial<Shift>): Shift {
  return {
    id: SHIFT_CLOSED_ID,
    opened_at: "2026-07-26T08:00:00.000Z",
    closed_at: "2026-07-26T20:00:00.000Z",
    status: "closed",
    notes: null,
    created_at: "2026-07-26T08:00:00.000Z",
    ...overrides,
  };
}

function salesSummary(
  overrides?: Partial<DailySalesSummary>,
): DailySalesSummary {
  return {
    id: "sales-summary-1",
    shift_id: SHIFT_CLOSED_ID,
    sales_count: 5,
    items_sold: 12,
    gross_revenue: 120,
    net_revenue: 100,
    average_receipt: 20,
    generated_at: "2026-07-26T20:00:00.000Z",
    created_at: "2026-07-26T20:00:00.000Z",
    ...overrides,
  };
}

function profitSummary(
  overrides?: Partial<DailyProfitSummary>,
): DailyProfitSummary {
  return {
    id: "profit-summary-1",
    shift_id: SHIFT_CLOSED_ID,
    net_revenue: 100,
    total_cogs: 40,
    gross_profit: 60,
    gross_margin_percent: 60,
    generated_at: "2026-07-26T20:00:00.000Z",
    created_at: "2026-07-26T20:00:00.000Z",
    ...overrides,
  };
}

function reconciliation(
  overrides?: Partial<CashReconciliation>,
): CashReconciliation {
  return {
    id: "recon-1",
    shift_id: SHIFT_CLOSED_ID,
    expected_cash: 100,
    counted_cash: 98,
    difference: -2,
    notes: null,
    reconciled_at: "2026-07-26T20:05:00.000Z",
    created_at: "2026-07-26T20:05:00.000Z",
    ...overrides,
  };
}

function alert(overrides?: Partial<LowStockAlert>): LowStockAlert {
  return {
    ingredient_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ingredient_name: "Flour",
    unit: "kg",
    alert_level: "critical",
    current_quantity: 2,
    days_remaining: 1,
    recommended_quantity: 26,
    alert_reason: "Forecast is critical; replenish to target stock.",
    ...overrides,
  };
}

function kpi(overrides?: Partial<DashboardSummary>): DashboardSummary {
  return {
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
    ...overrides,
  };
}

describe("dashboard-read-model-builder (DEV-122)", () => {
  it("composes a complete dashboard with closed-shift review slices", () => {
    const result = buildDashboardReadModel({
      current_shift: null,
      latest_closed_shift: closedShift(),
      daily_sales_summary: salesSummary(),
      daily_profit_summary: profitSummary(),
      cash_reconciliation: reconciliation(),
      low_stock_alerts: [alert()],
      kpi_summary: kpi(),
    });

    expect(result.error).toBeNull();
    expect(result.data.current_shift).toBeNull();
    expect(result.data.latest_closed_shift?.id).toBe(SHIFT_CLOSED_ID);
    expect(result.data.daily_sales_summary?.sales_count).toBe(5);
    expect(result.data.daily_profit_summary?.gross_profit).toBe(60);
    expect(result.data.cash_reconciliation?.difference).toBe(-2);
    expect(result.data.low_stock_alerts).toHaveLength(1);
    expect(result.data.kpi_summary?.total_inventory_value).toBe(1000);
  });

  it("composes an open shift without closed-shift summaries", () => {
    const result = buildDashboardReadModel({
      current_shift: openShift(),
      latest_closed_shift: null,
      daily_sales_summary: salesSummary(),
      daily_profit_summary: profitSummary(),
      cash_reconciliation: reconciliation(),
      low_stock_alerts: [],
      kpi_summary: kpi(),
    });

    expect(result.error).toBeNull();
    expect(result.data.current_shift?.id).toBe(SHIFT_OPEN_ID);
    expect(result.data.latest_closed_shift).toBeNull();
    expect(result.data.daily_sales_summary).toBeNull();
    expect(result.data.daily_profit_summary).toBeNull();
    expect(result.data.cash_reconciliation).toBeNull();
    expect(result.data.low_stock_alerts).toEqual([]);
  });

  it("builds an empty dashboard when no shift and no modules", () => {
    const result = buildDashboardReadModel({
      current_shift: null,
      latest_closed_shift: null,
      daily_sales_summary: null,
      daily_profit_summary: null,
      cash_reconciliation: null,
      low_stock_alerts: null,
      kpi_summary: null,
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      current_shift: null,
      latest_closed_shift: null,
      daily_sales_summary: null,
      daily_profit_summary: null,
      cash_reconciliation: null,
      low_stock_alerts: null,
      kpi_summary: null,
    });
  });

  it("allows partial data when summaries or alerts are missing", () => {
    const result = buildDashboardReadModel({
      current_shift: null,
      latest_closed_shift: closedShift(),
      daily_sales_summary: salesSummary(),
      daily_profit_summary: null,
      cash_reconciliation: null,
      low_stock_alerts: null,
      kpi_summary: kpi(),
    });

    expect(result.error).toBeNull();
    expect(result.data.daily_sales_summary?.id).toBe("sales-summary-1");
    expect(result.data.daily_profit_summary).toBeNull();
    expect(result.data.cash_reconciliation).toBeNull();
    expect(result.data.low_stock_alerts).toBeNull();
    expect(result.data.kpi_summary).not.toBeNull();
  });

  it("rejects conflicting open and closed shift context", () => {
    const result = buildDashboardReadModel({
      current_shift: openShift(),
      latest_closed_shift: closedShift(),
      daily_sales_summary: null,
      daily_profit_summary: null,
      cash_reconciliation: null,
      low_stock_alerts: [],
      kpi_summary: null,
    });

    expect(result.data.current_shift).toBeNull();
    expect(result.error).toMatch(/cannot include both/i);
  });

  it("asserts historical consistency for identical compositions", () => {
    const input = {
      current_shift: null as Shift | null,
      latest_closed_shift: closedShift(),
      daily_sales_summary: salesSummary(),
      daily_profit_summary: profitSummary(),
      cash_reconciliation: reconciliation(),
      low_stock_alerts: [alert()] as LowStockAlert[] | null,
      kpi_summary: kpi(),
    };

    const first = buildDashboardReadModel(input);
    const second = buildDashboardReadModel({ ...input });

    expect(
      assertDashboardReadModelHistoricallyConsistent({
        previous: first.data as DashboardReadModel,
        next: second.data as DashboardReadModel,
      }),
    ).toBeNull();
  });
});
