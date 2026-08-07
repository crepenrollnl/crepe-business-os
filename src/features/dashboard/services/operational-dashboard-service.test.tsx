/**
 * Service + rendering coverage for Operational Dashboard (DEV-124).
 */

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { formatDateTime } from "@/lib/date";
import { OperationalDashboardSection } from "../components/operational-dashboard-section";

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
import { operationalDashboardService } from "./operational-dashboard-service";
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

describe("operationalDashboardService (DEV-124)", () => {
  it("projects a closed-shift operational model from the read model", () => {
    const result = operationalDashboardService.buildFromReadModel(
      readModel({
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
          sales_count: 4,
          items_sold: 8,
          gross_revenue: 110,
          net_revenue: 90,
          average_receipt: 22.5,
          generated_at: "2026-07-26T20:00:00.000Z",
          created_at: "2026-07-26T20:00:00.000Z",
        },
        daily_profit_summary: {
          id: "profit-1",
          shift_id: SHIFT_CLOSED_ID,
          net_revenue: 90,
          total_cogs: 35,
          gross_profit: 55,
          gross_margin_percent: 61.11,
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
    expect(result.data?.shift_context).toBe("closed");
    expect(
      result.data?.fields.find((field) => field.id === "sales_today")
        ?.display_value,
    ).toBe("4");
    expect(
      result.data?.fields.find((field) => field.id === "gross_profit_today")
        ?.display_value,
    ).toBe("€55.00");
    expect(
      result.data?.fields.find(
        (field) => field.id === "cash_reconciliation_status",
      )?.display_value,
    ).toBe("Balanced");
    expect(
      result.data?.fields.find(
        (field) => field.id === "critical_inventory_alerts",
      )?.numeric_value,
    ).toBe(1);
  });

  it("loads through dashboard read model only", async () => {
    vi.mocked(dashboardService.getDashboardReadModel).mockResolvedValue({
      data: readModel({
        current_shift: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          opened_at: "2026-07-27T08:00:00.000Z",
          closed_at: null,
          status: "open",
          notes: null,
          created_at: "2026-07-27T08:00:00.000Z",
        },
      }),
      error: null,
    });

    const result = await operationalDashboardService.getOperationalDashboard();

    expect(result.error).toBeNull();
    expect(result.data?.shift_context).toBe("open");
    expect(dashboardService.getDashboardReadModel).toHaveBeenCalledTimes(1);
  });
});

describe("OperationalDashboardSection rendering (DEV-124)", () => {
  it("renders operational fields and hides not-applicable cash status", () => {
    const built = operationalDashboardService.buildFromReadModel(
      readModel({
        current_shift: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          opened_at: "2026-07-27T08:00:00.000Z",
          closed_at: null,
          status: "open",
          notes: null,
          created_at: "2026-07-27T08:00:00.000Z",
        },
      }),
    );

    const html = renderToStaticMarkup(
      <OperationalDashboardSection model={built.data!} />,
    );

    expect(html).toContain("Shift Context");
    expect(html).toContain("Open");
    expect(html).toContain(formatDateTime("2026-07-27T08:00:00.000Z"));
    expect(html).not.toContain("Cash Reconciliation Status");
  });
});
