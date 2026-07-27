/**
 * Service + section rendering coverage for Dashboard Completion (DEV-126).
 */

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BusinessHealthPanel } from "../components/business-health-panel";
import { DashboardKpiCards } from "../components/dashboard-kpi-cards";
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

import { dashboardCompletionService } from "./dashboard-completion-service";
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

describe("dashboardCompletionService (DEV-126)", () => {
  it("composes a full dashboard from the read model", () => {
    const result = dashboardCompletionService.buildFromReadModel(
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
          shift_id: SHIFT_CLOSED_ID,
          net_revenue: 75,
          total_cogs: 30,
          gross_profit: 45,
          gross_margin_percent: 60,
          generated_at: "2026-07-26T20:00:00.000Z",
          created_at: "2026-07-26T20:00:00.000Z",
        },
        cash_reconciliation: {
          id: "recon-1",
          shift_id: SHIFT_CLOSED_ID,
          expected_cash: 100,
          counted_cash: 98,
          difference: -2,
          notes: null,
          reconciled_at: "2026-07-26T20:05:00.000Z",
          created_at: "2026-07-26T20:05:00.000Z",
        },
        low_stock_alerts: [],
      }),
    );

    expect(result.error).toBeNull();
    expect(result.data?.kpi_cards.length).toBe(4);
    expect(result.data?.operational).toBeTruthy();
    expect(result.data?.business_health.overall_level).toBe("critical");
    expect(
      result.data?.daily_snapshot.fields.find(
        (field) => field.id === "daily_revenue",
      )?.display_value,
    ).toBe("€90.00");
  });

  it("loads through dashboard read model only", async () => {
    vi.mocked(dashboardService.getDashboardReadModel).mockResolvedValue({
      data: readModel(),
      error: null,
    });

    const result = await dashboardCompletionService.getDashboardCompletion();

    expect(result.error).toBeNull();
    expect(result.data?.operational.shift_context).toBe("none");
    expect(dashboardService.getDashboardReadModel).toHaveBeenCalledTimes(1);
  });
});

describe("Dashboard completion section rendering (DEV-126)", () => {
  it("renders KPI, operational, and business health sections", () => {
    const built = dashboardCompletionService.buildFromReadModel(
      readModel({
        current_shift: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          opened_at: "2026-07-27T08:00:00.000Z",
          closed_at: null,
          status: "open",
          notes: null,
          created_at: "2026-07-27T08:00:00.000Z",
        },
        low_stock_alerts: [],
      }),
    );

    const model = built.data!;
    const kpiHtml = renderToStaticMarkup(
      <DashboardKpiCards cards={model.kpi_cards} />,
    );
    const operationalHtml = renderToStaticMarkup(
      <OperationalDashboardSection model={model.operational} />,
    );
    const healthHtml = renderToStaticMarkup(
      <BusinessHealthPanel model={model.business_health} />,
    );

    expect(kpiHtml).toContain("dashboard-kpi-cards");
    expect(kpiHtml).toContain("Active Shift Status");
    expect(operationalHtml).toContain("Shift Context");
    expect(operationalHtml).toContain("Open");
    expect(healthHtml).toContain("Business Health");
    expect(healthHtml).toContain("Healthy");
  });
});
