/**
 * Dashboard read service (DEV-042 / DEV-044 / DEV-122).
 *
 * DEV-042/044: reads dashboard_summary KPIs (no recalculation).
 * DEV-122: composes DashboardReadModel from existing immutable services.
 */

import { lowStockAlertService } from "@/features/inventory/services/low-stock-alert-service";
import type { LowStockAlert } from "@/features/inventory/types/low-stock-alert";
import { cashReconciliationService } from "@/features/shifts/services/cash-reconciliation-service";
import { dailyProfitSummaryService } from "@/features/shifts/services/daily-profit-summary-service";
import { dailySalesSummaryService } from "@/features/shifts/services/daily-sales-summary-service";
import { shiftService } from "@/features/shifts/services/shift-service";
import type { CashReconciliation } from "@/features/shifts/types/cash-reconciliation";
import type { DailyProfitSummary } from "@/features/shifts/types/daily-profit-summary";
import type { DailySalesSummary } from "@/features/shifts/types/daily-sales-summary";
import type { Shift } from "@/features/shifts/types/shift";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { DashboardSummary } from "../types/dashboard";
import type { DashboardReadModel } from "../types/dashboard-read-model";
import {
  assertDashboardReadModelHistoricallyConsistent,
  buildDashboardReadModel,
} from "../utils/dashboard-read-model-builder";

const DASHBOARD_SUMMARY_VIEW = "dashboard_summary";

const DASHBOARD_SELECT = [
  "total_inventory_value",
  "inventory_items_below_minimum",
  "finished_goods_available",
  "total_sales_count",
  "total_purchase_count",
  "active_customers_count",
  "active_suppliers_count",
  "low_stock_items",
  "out_of_stock_items",
  "batches_in_progress",
  "finished_batches_today",
  "draft_sales_count",
  "confirmed_sales_today",
  "draft_purchase_count",
  "completed_purchases_today",
  "last_inventory_movement_at",
  "last_sale_at",
  "last_purchase_at",
].join(", ");

interface DashboardSummarySqlRow {
  total_inventory_value: number | string;
  inventory_items_below_minimum: number | string;
  finished_goods_available: number | string;
  total_sales_count: number | string;
  total_purchase_count: number | string;
  active_customers_count: number | string;
  active_suppliers_count: number | string;
  low_stock_items: number | string;
  out_of_stock_items: number | string;
  batches_in_progress: number | string;
  finished_batches_today: number | string;
  draft_sales_count: number | string;
  confirmed_sales_today: number | string;
  draft_purchase_count: number | string;
  completed_purchases_today: number | string;
  last_inventory_movement_at: string | null;
  last_sale_at: string | null;
  last_purchase_at: string | null;
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function mapDashboardRow(row: DashboardSummarySqlRow): DashboardSummary {
  return {
    total_inventory_value: toNumber(row.total_inventory_value),
    inventory_items_below_minimum: toNumber(row.inventory_items_below_minimum),
    finished_goods_available: toNumber(row.finished_goods_available),
    total_sales_count: toNumber(row.total_sales_count),
    total_purchase_count: toNumber(row.total_purchase_count),
    active_customers_count: toNumber(row.active_customers_count),
    active_suppliers_count: toNumber(row.active_suppliers_count),
    low_stock_items: toNumber(row.low_stock_items),
    out_of_stock_items: toNumber(row.out_of_stock_items),
    batches_in_progress: toNumber(row.batches_in_progress),
    finished_batches_today: toNumber(row.finished_batches_today),
    draft_sales_count: toNumber(row.draft_sales_count),
    confirmed_sales_today: toNumber(row.confirmed_sales_today),
    draft_purchase_count: toNumber(row.draft_purchase_count),
    completed_purchases_today: toNumber(row.completed_purchases_today),
    last_inventory_movement_at: row.last_inventory_movement_at,
    last_sale_at: row.last_sale_at,
    last_purchase_at: row.last_purchase_at,
  };
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message =
        typeof err === "object" &&
        err !== null &&
        "message" in err &&
        typeof (err as { message: unknown }).message === "string"
          ? (err as { message: string }).message
          : typeof err === "string"
            ? err
            : null;

      if (!message) {
        return null;
      }

      const normalized = message.toLowerCase();

      if (
        normalized.includes("dashboard_summary") &&
        (normalized.includes("does not exist") ||
          normalized.includes("schema cache") ||
          normalized.includes("42p01"))
      ) {
        return "Dashboard summary is not available yet. Apply the dashboard foundation database script and try again.";
      }

      return null;
    },
  });
}

async function loadClosedShiftExtras(shift: Shift): Promise<{
  daily_sales_summary: DailySalesSummary | null;
  daily_profit_summary: DailyProfitSummary | null;
  cash_reconciliation: CashReconciliation | null;
}> {
  const [salesResult, profitResult, reconciliationResult] = await Promise.all([
    dailySalesSummaryService.getSummaryForShift(shift.id),
    dailyProfitSummaryService.getSummaryForShift(shift.id),
    cashReconciliationService.getReconciliationForShift(shift.id),
  ]);

  return {
    daily_sales_summary: salesResult.error ? null : (salesResult.data ?? null),
    daily_profit_summary: profitResult.error
      ? null
      : (profitResult.data ?? null),
    cash_reconciliation: reconciliationResult.error
      ? null
      : (reconciliationResult.data ?? null),
  };
}

export const dashboardService = {
  buildDashboardReadModel,
  assertDashboardReadModelHistoricallyConsistent,

  /**
   * Load the single dashboard_summary KPI row (foundation + operational KPIs).
   */
  async getDashboardSummary(): Promise<ServiceResult<DashboardSummary>> {
    try {
      const { data, error } = await supabase
        .from(DASHBOARD_SUMMARY_VIEW)
        .select(DASHBOARD_SELECT)
        .maybeSingle();

      if (error) {
        return fail(mapReadError(error, "Failed to load dashboard summary"));
      }

      if (!data) {
        return fail("Dashboard summary was not found.");
      }

      return ok(mapDashboardRow(data as DashboardSummarySqlRow));
    } catch (error) {
      return fail(mapReadError(error, "Failed to load dashboard summary"));
    }
  },

  /**
   * Compose the Dashboard read model from existing immutable services.
   * Missing modules stay null — never recalculated or invented.
   */
  async getDashboardReadModel(): Promise<ServiceResult<DashboardReadModel>> {
    try {
      const [activeResult, alertsResult, kpiResult] = await Promise.all([
        shiftService.getActiveShift(),
        lowStockAlertService.getLowStockAlerts(),
        this.getDashboardSummary(),
      ]);

      if (activeResult.error) {
        return fail(activeResult.error);
      }

      const lowStockAlerts: LowStockAlert[] | null = alertsResult.error
        ? null
        : (alertsResult.data ?? []);
      const kpiSummary = kpiResult.error ? null : (kpiResult.data ?? null);

      const activeShift = activeResult.data;

      if (activeShift) {
        const built = buildDashboardReadModel({
          current_shift: activeShift,
          latest_closed_shift: null,
          daily_sales_summary: null,
          daily_profit_summary: null,
          cash_reconciliation: null,
          low_stock_alerts: lowStockAlerts,
          kpi_summary: kpiSummary,
        });

        if (built.error) {
          return fail(built.error);
        }

        return ok(built.data);
      }

      const closedResult = await shiftService.getLatestClosedShift();
      if (closedResult.error) {
        return fail(closedResult.error);
      }

      const latestClosed = closedResult.data;

      if (!latestClosed) {
        const built = buildDashboardReadModel({
          current_shift: null,
          latest_closed_shift: null,
          daily_sales_summary: null,
          daily_profit_summary: null,
          cash_reconciliation: null,
          low_stock_alerts: lowStockAlerts,
          kpi_summary: kpiSummary,
        });

        if (built.error) {
          return fail(built.error);
        }

        return ok(built.data);
      }

      const extras = await loadClosedShiftExtras(latestClosed);

      const built = buildDashboardReadModel({
        current_shift: null,
        latest_closed_shift: latestClosed,
        daily_sales_summary: extras.daily_sales_summary,
        daily_profit_summary: extras.daily_profit_summary,
        cash_reconciliation: extras.cash_reconciliation,
        low_stock_alerts: lowStockAlerts,
        kpi_summary: kpiSummary,
      });

      if (built.error) {
        return fail(built.error);
      }

      return ok(built.data);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load dashboard read model";
      return fail(message);
    }
  },
};
