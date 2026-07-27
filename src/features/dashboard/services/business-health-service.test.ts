/**
 * Service-level coverage for businessHealthService (DEV-125).
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

import { businessHealthService } from "./business-health-service";
import { dashboardService } from "./dashboard-service";
import type { DashboardReadModel } from "../types/dashboard-read-model";

const SHIFT_CLOSED_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

describe("businessHealthService (DEV-125)", () => {
  it("composes health from an existing read model", () => {
    const result = businessHealthService.buildFromReadModel(
      readModel({
        latest_closed_shift: {
          id: SHIFT_CLOSED_ID,
          opened_at: "2026-07-26T08:00:00.000Z",
          closed_at: "2026-07-26T20:00:00.000Z",
          status: "closed",
          notes: null,
          created_at: "2026-07-26T08:00:00.000Z",
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
        low_stock_alerts: [],
      }),
    );

    expect(result.error).toBeNull();
    expect(result.data?.overall_level).toBe("healthy");
    expect(result.data?.indicators).toHaveLength(4);
  });

  it("loads through the dashboard read model only", async () => {
    vi.mocked(dashboardService.getDashboardReadModel).mockResolvedValue({
      data: readModel({
        low_stock_alerts: [
          {
            ingredient_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            ingredient_name: "Flour",
            unit: "kg",
            alert_level: "critical",
            current_quantity: 1,
            days_remaining: 0.5,
            recommended_quantity: 27,
            alert_reason: "Forecast is critical; replenish to target stock.",
          },
        ],
      }),
      error: null,
    });

    const result = await businessHealthService.getBusinessHealth();

    expect(result.error).toBeNull();
    expect(result.data?.overall_level).toBe("critical");
    expect(dashboardService.getDashboardReadModel).toHaveBeenCalledTimes(1);
  });
});
