/**
 * KPI Dashboard read service (DEV-068).
 *
 * Reads exclusively via get_kpi_dashboard RPC.
 * Does NOT mutate data, recalculate metrics, cache, or write tables.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { KpiDashboard } from "../types/kpi-dashboard";

function rpcErrorMessage(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return typeof error === "string" ? error : null;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function nullableNumber(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  return toNumber(value);
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  const parsed = toNumber(value);
  if (parsed === undefined || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} is invalid.`);
  }
  return parsed;
}

function mapKpiDashboard(data: unknown): KpiDashboard {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("KPI dashboard response is invalid.");
  }

  const row = data as Record<string, unknown>;
  const grossRevenue = toNumber(row.gross_revenue);
  const averageOrderValue = toNumber(row.average_order_value);
  const inventoryTurnover = nullableNumber(row.inventory_turnover);
  const recipeCostAverage = nullableNumber(row.recipe_cost_average);
  const productionEfficiency = nullableNumber(row.production_efficiency);
  const lowStockRatio = nullableNumber(row.low_stock_ratio);
  const salesGrowth = nullableNumber(row.sales_growth);

  if (grossRevenue === undefined) {
    throw new Error("Gross revenue is invalid.");
  }

  if (averageOrderValue === undefined) {
    throw new Error("Average order value is invalid.");
  }

  if (inventoryTurnover === undefined) {
    throw new Error("Inventory turnover is invalid.");
  }

  if (recipeCostAverage === undefined) {
    throw new Error("Recipe cost average is invalid.");
  }

  if (productionEfficiency === undefined) {
    throw new Error("Production efficiency is invalid.");
  }

  if (lowStockRatio === undefined) {
    throw new Error("Low stock ratio is invalid.");
  }

  if (salesGrowth === undefined) {
    throw new Error("Sales growth is invalid.");
  }

  return {
    gross_revenue: grossRevenue,
    total_orders: requireNonNegativeInteger(row.total_orders, "Total orders"),
    average_order_value: averageOrderValue,
    inventory_turnover: inventoryTurnover,
    recipe_cost_average: recipeCostAverage,
    supplier_count: requireNonNegativeInteger(
      row.supplier_count,
      "Supplier count",
    ),
    customer_count: requireNonNegativeInteger(
      row.customer_count,
      "Customer count",
    ),
    production_efficiency: productionEfficiency,
    low_stock_ratio: lowStockRatio,
    sales_growth: salesGrowth,
  };
}

function mapKpiDashboardRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("get_kpi_dashboard") ||
      normalized.includes("kpi_dashboard")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883") ||
        normalized.includes("42p01")))
  ) {
    return "KPI dashboard is not available yet. Apply the KPI dashboard database script and try again.";
  }

  return null;
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapKpiDashboardRpcError(message) : null;
    },
  });
}

export const kpiDashboardService = {
  /**
   * Load KPI dashboard summary via get_kpi_dashboard RPC.
   */
  async getKpiDashboard(): Promise<ServiceResult<KpiDashboard>> {
    try {
      const { data, error } = await supabase.rpc("get_kpi_dashboard");

      if (error) {
        return fail(mapReadError(error, "Failed to load KPI dashboard"));
      }

      try {
        return ok(mapKpiDashboard(data));
      } catch {
        return fail("KPI dashboard response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load KPI dashboard"));
    }
  },
};
