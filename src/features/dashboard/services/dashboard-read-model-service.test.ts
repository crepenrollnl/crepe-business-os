/**
 * Service-level coverage for dashboardService.getDashboardReadModel (DEV-122).
 *
 * Composes existing immutable services — no recalculation / SQL for the model.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  supabaseMock,
  shiftServiceMock,
  cashReconciliationServiceMock,
  dailySalesSummaryServiceMock,
  dailyProfitSummaryServiceMock,
  lowStockAlertServiceMock,
} = vi.hoisted(() => {
  const supabaseMock = {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn(),
    },
  };

  return {
    supabaseMock,
    shiftServiceMock: {
      getActiveShift: vi.fn(),
      getLatestClosedShift: vi.fn(),
    },
    cashReconciliationServiceMock: {
      getReconciliationForShift: vi.fn(),
    },
    dailySalesSummaryServiceMock: {
      getSummaryForShift: vi.fn(),
    },
    dailyProfitSummaryServiceMock: {
      getSummaryForShift: vi.fn(),
    },
    lowStockAlertServiceMock: {
      getLowStockAlerts: vi.fn(),
    },
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

vi.mock("@/features/shifts/services/shift-service", () => ({
  shiftService: shiftServiceMock,
}));

vi.mock("@/features/shifts/services/cash-reconciliation-service", () => ({
  cashReconciliationService: cashReconciliationServiceMock,
}));

vi.mock("@/features/shifts/services/daily-sales-summary-service", () => ({
  dailySalesSummaryService: dailySalesSummaryServiceMock,
}));

vi.mock("@/features/shifts/services/daily-profit-summary-service", () => ({
  dailyProfitSummaryService: dailyProfitSummaryServiceMock,
}));

vi.mock("@/features/inventory/services/low-stock-alert-service", () => ({
  lowStockAlertService: lowStockAlertServiceMock,
}));

import { dashboardService } from "./dashboard-service";

const SHIFT_OPEN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHIFT_CLOSED_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function mockKpiSummary() {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: {
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
    error: null,
  });
  const select = vi.fn().mockReturnValue({ maybeSingle });
  supabaseMock.from.mockReturnValue({ select });
}

describe("dashboardService.getDashboardReadModel (DEV-122)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKpiSummary();
  });

  it("composes a complete dashboard for a closed shift", async () => {
    shiftServiceMock.getActiveShift.mockResolvedValue({
      data: null,
      error: null,
    });
    shiftServiceMock.getLatestClosedShift.mockResolvedValue({
      data: {
        id: SHIFT_CLOSED_ID,
        opened_at: "2026-07-26T08:00:00.000Z",
        closed_at: "2026-07-26T20:00:00.000Z",
        status: "closed",
        notes: null,
        created_at: "2026-07-26T08:00:00.000Z",
      },
      error: null,
    });
    dailySalesSummaryServiceMock.getSummaryForShift.mockResolvedValue({
      data: {
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
      error: null,
    });
    dailyProfitSummaryServiceMock.getSummaryForShift.mockResolvedValue({
      data: {
        id: "profit-1",
        shift_id: SHIFT_CLOSED_ID,
        net_revenue: 100,
        total_cogs: 40,
        gross_profit: 60,
        gross_margin_percent: 60,
        generated_at: "2026-07-26T20:00:00.000Z",
        created_at: "2026-07-26T20:00:00.000Z",
      },
      error: null,
    });
    cashReconciliationServiceMock.getReconciliationForShift.mockResolvedValue({
      data: {
        id: "recon-1",
        shift_id: SHIFT_CLOSED_ID,
        expected_cash: 100,
        counted_cash: 100,
        difference: 0,
        notes: null,
        reconciled_at: "2026-07-26T20:05:00.000Z",
        created_at: "2026-07-26T20:05:00.000Z",
      },
      error: null,
    });
    lowStockAlertServiceMock.getLowStockAlerts.mockResolvedValue({
      data: [
        {
          ingredient_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          ingredient_name: "Flour",
          unit: "kg",
          alert_level: "low",
          current_quantity: 8,
          days_remaining: 4,
          recommended_quantity: 20,
          alert_reason: "Forecast is low; replenish to target stock.",
        },
      ],
      error: null,
    });

    const result = await dashboardService.getDashboardReadModel();

    expect(result.error).toBeNull();
    expect(result.data?.latest_closed_shift?.id).toBe(SHIFT_CLOSED_ID);
    expect(result.data?.daily_sales_summary?.sales_count).toBe(5);
    expect(result.data?.daily_profit_summary?.gross_profit).toBe(60);
    expect(result.data?.cash_reconciliation?.difference).toBe(0);
    expect(result.data?.low_stock_alerts).toHaveLength(1);
    expect(result.data?.kpi_summary?.total_inventory_value).toBe(1000);
  });

  it("composes a partial dashboard when summaries and alerts are missing", async () => {
    shiftServiceMock.getActiveShift.mockResolvedValue({
      data: null,
      error: null,
    });
    shiftServiceMock.getLatestClosedShift.mockResolvedValue({
      data: {
        id: SHIFT_CLOSED_ID,
        opened_at: "2026-07-26T08:00:00.000Z",
        closed_at: "2026-07-26T20:00:00.000Z",
        status: "closed",
        notes: null,
        created_at: "2026-07-26T08:00:00.000Z",
      },
      error: null,
    });
    dailySalesSummaryServiceMock.getSummaryForShift.mockResolvedValue({
      data: null,
      error: null,
    });
    dailyProfitSummaryServiceMock.getSummaryForShift.mockResolvedValue({
      data: null,
      error: null,
    });
    cashReconciliationServiceMock.getReconciliationForShift.mockResolvedValue({
      data: null,
      error: null,
    });
    lowStockAlertServiceMock.getLowStockAlerts.mockResolvedValue({
      data: null,
      error: "Alerts unavailable",
    });

    const result = await dashboardService.getDashboardReadModel();

    expect(result.error).toBeNull();
    expect(result.data?.latest_closed_shift?.id).toBe(SHIFT_CLOSED_ID);
    expect(result.data?.daily_sales_summary).toBeNull();
    expect(result.data?.daily_profit_summary).toBeNull();
    expect(result.data?.cash_reconciliation).toBeNull();
    expect(result.data?.low_stock_alerts).toBeNull();
    expect(result.data?.kpi_summary).not.toBeNull();
  });

  it("builds an empty shift context when no active or closed shift", async () => {
    shiftServiceMock.getActiveShift.mockResolvedValue({
      data: null,
      error: null,
    });
    shiftServiceMock.getLatestClosedShift.mockResolvedValue({
      data: null,
      error: null,
    });
    lowStockAlertServiceMock.getLowStockAlerts.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await dashboardService.getDashboardReadModel();

    expect(result.error).toBeNull();
    expect(result.data?.current_shift).toBeNull();
    expect(result.data?.latest_closed_shift).toBeNull();
    expect(result.data?.daily_sales_summary).toBeNull();
    expect(result.data?.low_stock_alerts).toEqual([]);
    expect(
      dailySalesSummaryServiceMock.getSummaryForShift,
    ).not.toHaveBeenCalled();
  });

  it("loads open shift without requesting closed-shift modules", async () => {
    shiftServiceMock.getActiveShift.mockResolvedValue({
      data: {
        id: SHIFT_OPEN_ID,
        opened_at: "2026-07-27T08:00:00.000Z",
        closed_at: null,
        status: "open",
        notes: null,
        created_at: "2026-07-27T08:00:00.000Z",
      },
      error: null,
    });
    lowStockAlertServiceMock.getLowStockAlerts.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await dashboardService.getDashboardReadModel();

    expect(result.error).toBeNull();
    expect(result.data?.current_shift?.id).toBe(SHIFT_OPEN_ID);
    expect(result.data?.latest_closed_shift).toBeNull();
    expect(result.data?.daily_sales_summary).toBeNull();
    expect(shiftServiceMock.getLatestClosedShift).not.toHaveBeenCalled();
    expect(
      dailySalesSummaryServiceMock.getSummaryForShift,
    ).not.toHaveBeenCalled();
  });
});
