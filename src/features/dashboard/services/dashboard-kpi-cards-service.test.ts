/**
 * Service-level coverage for dashboardKpiCardsService (DEV-123).
 */

import { describe, expect, it, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => {
  const supabaseMock = {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn(),
    },
  };
  return { supabaseMock };
});

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

vi.mock("./dashboard-service", () => ({
  dashboardService: {
    getDashboardReadModel: vi.fn(),
  },
}));

import { dashboardService } from "./dashboard-service";
import { dashboardKpiCardsService } from "./dashboard-kpi-cards-service";
import type { DashboardReadModel } from "../types/dashboard-read-model";

const SHIFT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function readModel(
  overrides?: Partial<DashboardReadModel>,
): DashboardReadModel {
  return {
    current_shift: null,
    latest_closed_shift: null,
    daily_sales_summary: null,
    daily_profit_summary: null,
    cash_reconciliation: null,
    low_stock_alerts: [],
    kpi_summary: null,
    ...overrides,
  };
}

describe("dashboardKpiCardsService (DEV-123)", () => {
  it("projects cards from an existing read model", () => {
    const result = dashboardKpiCardsService.buildFromReadModel(
      readModel({
        current_shift: {
          id: SHIFT_ID,
          opened_at: "2026-07-27T08:00:00.000Z",
          closed_at: null,
          status: "open",
          notes: null,
          created_at: "2026-07-27T08:00:00.000Z",
        },
        low_stock_alerts: [
          {
            ingredient_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            ingredient_name: "Flour",
            unit: "kg",
            alert_level: "critical",
            current_quantity: 2,
            days_remaining: 1,
            recommended_quantity: 26,
            alert_reason: "Forecast is critical; replenish to target stock.",
          },
        ],
      }),
    );

    expect(result.error).toBeNull();
    expect(result.data?.cards).toHaveLength(4);
    expect(
      result.data?.cards.find((card) => card.id === "active_shift_status")
        ?.display_value,
    ).toBe("Open");
    expect(
      result.data?.cards.find(
        (card) => card.id === "critical_inventory_alerts",
      )?.numeric_value,
    ).toBe(1);
  });

  it("loads cards through the dashboard read model service", async () => {
    vi.mocked(dashboardService.getDashboardReadModel).mockResolvedValue({
      data: readModel({
        daily_sales_summary: {
          id: "sales-1",
          shift_id: SHIFT_ID,
          sales_count: 2,
          items_sold: 4,
          gross_revenue: 50,
          net_revenue: 40,
          average_receipt: 25,
          generated_at: "2026-07-26T20:00:00.000Z",
          created_at: "2026-07-26T20:00:00.000Z",
        },
        daily_profit_summary: {
          id: "profit-1",
          shift_id: SHIFT_ID,
          net_revenue: 40,
          total_cogs: 15,
          gross_profit: 25,
          gross_margin_percent: 62.5,
          generated_at: "2026-07-26T20:00:00.000Z",
          created_at: "2026-07-26T20:00:00.000Z",
        },
      }),
      error: null,
    });

    const result = await dashboardKpiCardsService.getDashboardKpiCards();

    expect(result.error).toBeNull();
    expect(
      result.data?.cards.find((card) => card.id === "gross_revenue")
        ?.display_value,
    ).toBe("€50.00");
    expect(
      result.data?.cards.find((card) => card.id === "gross_profit")
        ?.display_value,
    ).toBe("€25.00");
  });
});
