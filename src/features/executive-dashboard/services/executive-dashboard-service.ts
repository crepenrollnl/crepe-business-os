/**
 * Executive Dashboard read service (DEV-067).
 *
 * Reads exclusively via get_executive_dashboard RPC.
 * Does NOT mutate data, recalculate metrics, cache, or write tables.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  ExecutiveCompanyHealth,
  ExecutiveDashboard,
} from "../types/executive-dashboard";

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

function nullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  const parsed = toNumber(value);
  if (parsed === undefined || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} is invalid.`);
  }
  return parsed;
}

function parseCompanyHealth(value: unknown): ExecutiveCompanyHealth {
  if (
    value === "ok" ||
    value === "attention" ||
    value === "critical" ||
    value === "unknown"
  ) {
    return value;
  }
  throw new Error("Company health is invalid.");
}

function mapExecutiveDashboard(data: unknown): ExecutiveDashboard {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Executive dashboard response is invalid.");
  }

  const row = data as Record<string, unknown>;
  const inventoryValue = toNumber(row.inventory_value);
  const salesGrowth = nullableNumber(row.sales_growth);
  const lastSaleDate = nullableString(row.last_sale_date);
  const lastPurchaseDate = nullableString(row.last_purchase_date);
  const lastProductionDate = nullableString(row.last_production_date);

  if (inventoryValue === undefined) {
    throw new Error("Inventory value is invalid.");
  }

  if (salesGrowth === undefined) {
    throw new Error("Sales growth is invalid.");
  }

  if (lastSaleDate === undefined) {
    throw new Error("Last sale date is invalid.");
  }

  if (lastPurchaseDate === undefined) {
    throw new Error("Last purchase date is invalid.");
  }

  if (lastProductionDate === undefined) {
    throw new Error("Last production date is invalid.");
  }

  return {
    company_health: parseCompanyHealth(row.company_health),
    inventory_value: inventoryValue,
    low_stock_count: requireNonNegativeInteger(
      row.low_stock_count,
      "Low stock count",
    ),
    total_sales: requireNonNegativeInteger(row.total_sales, "Total sales"),
    total_purchases: requireNonNegativeInteger(
      row.total_purchases,
      "Total purchases",
    ),
    total_batches: requireNonNegativeInteger(
      row.total_batches,
      "Total batches",
    ),
    sales_growth: salesGrowth,
    last_sale_date: lastSaleDate,
    last_purchase_date: lastPurchaseDate,
    last_production_date: lastProductionDate,
  };
}

function mapExecutiveDashboardRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("get_executive_dashboard") ||
      normalized.includes("executive_dashboard")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883") ||
        normalized.includes("42p01")))
  ) {
    return "Executive dashboard is not available yet. Apply the executive dashboard database script and try again.";
  }

  return null;
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapExecutiveDashboardRpcError(message) : null;
    },
  });
}

export const executiveDashboardService = {
  /**
   * Load executive dashboard summary via get_executive_dashboard RPC.
   */
  async getExecutiveDashboard(): Promise<ServiceResult<ExecutiveDashboard>> {
    try {
      const { data, error } = await supabase.rpc("get_executive_dashboard");

      if (error) {
        return fail(
          mapReadError(error, "Failed to load executive dashboard"),
        );
      }

      try {
        return ok(mapExecutiveDashboard(data));
      } catch {
        return fail("Executive dashboard response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load executive dashboard"));
    }
  },
};
