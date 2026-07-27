/**
 * Pure builder coverage for Operational Dashboard (DEV-124).
 */

import { describe, expect, it } from "vitest";
import type { DashboardReadModel } from "../types/dashboard-read-model";
import {
  buildOperationalDashboard,
  buildOperationalDashboardFromReadModel,
} from "./operational-dashboard-builder";

const SHIFT_OPEN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHIFT_CLOSED_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FLOUR_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function byId<T extends { id: string }>(fields: T[]) {
  return Object.fromEntries(fields.map((field) => [field.id, field]));
}

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

describe("operational-dashboard-builder (DEV-124)", () => {
  it("builds an open-shift operational view without closed-only cash status", () => {
    const result = buildOperationalDashboard({
      current_shift: {
        id: SHIFT_OPEN_ID,
        status: "open",
        opened_at: "2026-07-27T08:00:00.000Z",
      },
      latest_closed_shift: null,
      daily_sales_summary: null,
      daily_profit_summary: null,
      cash_reconciliation: null,
      low_stock_alerts: [],
    });

    expect(result.error).toBeNull();
    expect(result.data.shift_context).toBe("open");

    const fields = byId(result.data.fields);
    expect(fields.current_shift_status?.display_value).toBe("Open");
    expect(fields.shift_opened_at?.display_value).toBe(
      "2026-07-27T08:00:00.000Z",
    );
    expect(fields.sales_today?.availability).toBe("missing");
    expect(fields.net_revenue_today?.availability).toBe("missing");
    expect(fields.gross_profit_today?.availability).toBe("missing");
    expect(fields.cash_reconciliation_status?.availability).toBe(
      "not_applicable",
    );
    expect(fields.critical_inventory_alerts?.display_value).toBe("0");
  });

  it("builds a closed-shift operational view with summaries and cash status", () => {
    const result = buildOperationalDashboard({
      current_shift: null,
      latest_closed_shift: {
        id: SHIFT_CLOSED_ID,
        status: "closed",
        opened_at: "2026-07-26T08:00:00.000Z",
        closed_at: "2026-07-26T20:00:00.000Z",
      },
      daily_sales_summary: {
        sales_count: 5,
        net_revenue: 100,
      },
      daily_profit_summary: {
        gross_profit: 60,
      },
      cash_reconciliation: {
        difference: 0,
      },
      low_stock_alerts: [{ alert_level: "critical" }],
    });

    expect(result.data.shift_context).toBe("closed");
    const fields = byId(result.data.fields);

    expect(fields.current_shift_status?.display_value).toBe("Closed");
    expect(fields.shift_opened_at?.display_value).toBe(
      "2026-07-26T08:00:00.000Z",
    );
    expect(fields.sales_today).toMatchObject({
      display_value: "5",
      numeric_value: 5,
      availability: "available",
    });
    expect(fields.net_revenue_today).toMatchObject({
      display_value: "€100.00",
      numeric_value: 100,
    });
    expect(fields.gross_profit_today).toMatchObject({
      display_value: "€60.00",
      numeric_value: 60,
    });
    expect(fields.cash_reconciliation_status).toMatchObject({
      display_value: "Balanced",
      availability: "available",
    });
    expect(fields.critical_inventory_alerts?.numeric_value).toBe(1);
  });

  it("marks missing summaries without inventing values", () => {
    const result = buildOperationalDashboard({
      current_shift: null,
      latest_closed_shift: {
        id: SHIFT_CLOSED_ID,
        status: "closed",
        opened_at: "2026-07-26T08:00:00.000Z",
        closed_at: "2026-07-26T20:00:00.000Z",
      },
      daily_sales_summary: null,
      daily_profit_summary: null,
      cash_reconciliation: null,
      low_stock_alerts: null,
    });

    const fields = byId(result.data.fields);
    expect(fields.sales_today?.display_value).toBe("—");
    expect(fields.net_revenue_today?.display_value).toBe("—");
    expect(fields.gross_profit_today?.display_value).toBe("—");
    expect(fields.cash_reconciliation_status?.display_value).toBe("Pending");
    expect(fields.critical_inventory_alerts?.availability).toBe("missing");
  });

  it("handles no active shift context", () => {
    const result = buildOperationalDashboard({
      current_shift: null,
      latest_closed_shift: null,
      daily_sales_summary: null,
      daily_profit_summary: null,
      cash_reconciliation: null,
      low_stock_alerts: [],
    });

    expect(result.data.shift_context).toBe("none");
    const fields = byId(result.data.fields);
    expect(fields.current_shift_status?.display_value).toBe("None");
    expect(fields.shift_opened_at?.display_value).toBe("—");
    expect(fields.cash_reconciliation_status?.availability).toBe(
      "not_applicable",
    );
  });

  it("counts critical alerts from the read model", () => {
    const result = buildOperationalDashboardFromReadModel(
      emptyReadModel({
        low_stock_alerts: [
          {
            ingredient_id: FLOUR_ID,
            ingredient_name: "Flour",
            unit: "kg",
            alert_level: "critical",
            current_quantity: 1,
            days_remaining: 0.5,
            recommended_quantity: 27,
            alert_reason: "Forecast is critical; replenish to target stock.",
          },
          {
            ingredient_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            ingredient_name: "Milk",
            unit: "L",
            alert_level: "low",
            current_quantity: 8,
            days_remaining: 5,
            recommended_quantity: 20,
            alert_reason: "Forecast is low; replenish to target stock.",
          },
        ],
      }),
    );

    const alerts = result.data.fields.find(
      (field) => field.id === "critical_inventory_alerts",
    );
    expect(alerts?.numeric_value).toBe(1);
    expect(alerts?.display_value).toBe("1");
  });

  it("marks cash reconciliation difference from stored fact", () => {
    const result = buildOperationalDashboard({
      current_shift: null,
      latest_closed_shift: {
        id: SHIFT_CLOSED_ID,
        status: "closed",
        opened_at: "2026-07-26T08:00:00.000Z",
        closed_at: "2026-07-26T20:00:00.000Z",
      },
      daily_sales_summary: { sales_count: 1, net_revenue: 10 },
      daily_profit_summary: { gross_profit: 4 },
      cash_reconciliation: { difference: -2.5 },
      low_stock_alerts: [],
    });

    const cash = result.data.fields.find(
      (field) => field.id === "cash_reconciliation_status",
    );
    expect(cash?.display_value).toBe("Difference");
    expect(cash?.detail).toMatch(/€-2\.50/);
  });
});
