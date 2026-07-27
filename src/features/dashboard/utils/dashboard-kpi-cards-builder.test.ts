/**
 * Pure builder coverage for Dashboard KPI Cards (DEV-123).
 */

import { describe, expect, it } from "vitest";
import type { DashboardReadModel } from "../types/dashboard-read-model";
import {
  buildDashboardKpiCards,
  buildDashboardKpiCardsFromReadModel,
} from "./dashboard-kpi-cards-builder";

const SHIFT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
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

describe("dashboard-kpi-cards-builder (DEV-123)", () => {
  it("builds empty/missing cards for an empty dashboard", () => {
    const result = buildDashboardKpiCards({
      current_shift: null,
      daily_sales_summary: null,
      daily_profit_summary: null,
      low_stock_alerts: null,
    });

    expect(result.error).toBeNull();
    expect(result.data.cards).toHaveLength(4);

    const byId = Object.fromEntries(
      result.data.cards.map((card) => [card.id, card]),
    );

    expect(byId.gross_revenue?.display_value).toBe("—");
    expect(byId.gross_revenue?.availability).toBe("missing");
    expect(byId.gross_profit?.display_value).toBe("—");
    expect(byId.gross_profit?.availability).toBe("missing");
    expect(byId.active_shift_status?.display_value).toBe("None");
    expect(byId.active_shift_status?.availability).toBe("empty");
    expect(byId.critical_inventory_alerts?.display_value).toBe("—");
    expect(byId.critical_inventory_alerts?.availability).toBe("missing");
  });

  it("builds normal cards from available read-model facts", () => {
    const result = buildDashboardKpiCards({
      current_shift: null,
      daily_sales_summary: { gross_revenue: 120.5 },
      daily_profit_summary: { gross_profit: 60.25 },
      low_stock_alerts: [
        { alert_level: "low" },
        { alert_level: "critical" },
        { alert_level: "critical" },
      ],
    });

    expect(result.error).toBeNull();
    const byId = Object.fromEntries(
      result.data.cards.map((card) => [card.id, card]),
    );

    expect(byId.gross_revenue).toMatchObject({
      display_value: "€120.50",
      numeric_value: 120.5,
      availability: "available",
    });
    expect(byId.gross_profit).toMatchObject({
      display_value: "€60.25",
      numeric_value: 60.25,
      availability: "available",
    });
    expect(byId.active_shift_status?.display_value).toBe("None");
    expect(byId.critical_inventory_alerts).toMatchObject({
      display_value: "2",
      numeric_value: 2,
      availability: "available",
    });
  });

  it("marks active shift status when a shift is open", () => {
    const result = buildDashboardKpiCards({
      current_shift: {
        id: SHIFT_ID,
        status: "open",
        opened_at: "2026-07-27T08:00:00.000Z",
      },
      daily_sales_summary: null,
      daily_profit_summary: null,
      low_stock_alerts: [],
    });

    const shiftCard = result.data.cards.find(
      (card) => card.id === "active_shift_status",
    );

    expect(shiftCard).toMatchObject({
      display_value: "Open",
      availability: "available",
      detail: "Opened 2026-07-27T08:00:00.000Z",
    });
  });

  it("shows zero critical alerts when the module loaded with none", () => {
    const result = buildDashboardKpiCards({
      current_shift: null,
      daily_sales_summary: null,
      daily_profit_summary: null,
      low_stock_alerts: [{ alert_level: "low" }],
    });

    const alertsCard = result.data.cards.find(
      (card) => card.id === "critical_inventory_alerts",
    );

    expect(alertsCard).toMatchObject({
      display_value: "0",
      numeric_value: 0,
      availability: "empty",
    });
  });

  it("handles missing modules without inventing values", () => {
    const result = buildDashboardKpiCardsFromReadModel(
      emptyReadModel({
        current_shift: {
          id: SHIFT_ID,
          opened_at: "2026-07-27T08:00:00.000Z",
          closed_at: null,
          status: "open",
          notes: null,
          created_at: "2026-07-27T08:00:00.000Z",
        },
        low_stock_alerts: null,
        daily_sales_summary: null,
        daily_profit_summary: null,
      }),
    );

    const byId = Object.fromEntries(
      result.data.cards.map((card) => [card.id, card]),
    );

    expect(byId.gross_revenue?.availability).toBe("missing");
    expect(byId.gross_profit?.availability).toBe("missing");
    expect(byId.active_shift_status?.display_value).toBe("Open");
    expect(byId.critical_inventory_alerts?.availability).toBe("missing");
  });

  it("counts only critical inventory alerts from the read model", () => {
    const result = buildDashboardKpiCardsFromReadModel(
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

    const byId = Object.fromEntries(
      result.data.cards.map((card) => [card.id, card]),
    );

    expect(byId.gross_revenue?.numeric_value).toBe(90);
    expect(byId.gross_profit?.numeric_value).toBe(45);
    expect(byId.critical_inventory_alerts?.numeric_value).toBe(1);
  });
});
