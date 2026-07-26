/**
 * Inventory Dashboard read service (DEV-064).
 *
 * Reads exclusively via get_inventory_dashboard RPC.
 * Does NOT mutate data, recalculate metrics, cache, or write tables.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { InventoryDashboard } from "../types/inventory-dashboard";

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

function nullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function mapInventoryDashboard(data: unknown): InventoryDashboard {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Inventory dashboard response is invalid.");
  }

  const row = data as Record<string, unknown>;
  const totalIngredients = toNumber(row.total_ingredients);
  const lowStockCount = toNumber(row.low_stock_count);
  const outOfStockCount = toNumber(row.out_of_stock_count);
  const totalInventoryValue = toNumber(row.total_inventory_value);
  const lastPurchaseDate = nullableString(row.last_purchase_date);
  const lastProductionDate = nullableString(row.last_production_date);

  if (
    totalIngredients === undefined ||
    !Number.isInteger(totalIngredients) ||
    totalIngredients < 0
  ) {
    throw new Error("Total ingredients is invalid.");
  }

  if (
    lowStockCount === undefined ||
    !Number.isInteger(lowStockCount) ||
    lowStockCount < 0
  ) {
    throw new Error("Low stock count is invalid.");
  }

  if (
    outOfStockCount === undefined ||
    !Number.isInteger(outOfStockCount) ||
    outOfStockCount < 0
  ) {
    throw new Error("Out of stock count is invalid.");
  }

  if (totalInventoryValue === undefined) {
    throw new Error("Total inventory value is invalid.");
  }

  if (lastPurchaseDate === undefined) {
    throw new Error("Last purchase date is invalid.");
  }

  if (lastProductionDate === undefined) {
    throw new Error("Last production date is invalid.");
  }

  return {
    total_ingredients: totalIngredients,
    low_stock_count: lowStockCount,
    out_of_stock_count: outOfStockCount,
    total_inventory_value: totalInventoryValue,
    last_purchase_date: lastPurchaseDate,
    last_production_date: lastProductionDate,
  };
}

function mapInventoryDashboardRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("get_inventory_dashboard") ||
      normalized.includes("inventory_dashboard")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883") ||
        normalized.includes("42p01")))
  ) {
    return "Inventory dashboard is not available yet. Apply the inventory dashboard database script and try again.";
  }

  return null;
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapInventoryDashboardRpcError(message) : null;
    },
  });
}

export const inventoryDashboardService = {
  /**
   * Load inventory dashboard summary via get_inventory_dashboard RPC.
   */
  async getInventoryDashboard(): Promise<ServiceResult<InventoryDashboard>> {
    try {
      const { data, error } = await supabase.rpc("get_inventory_dashboard");

      if (error) {
        return fail(
          mapReadError(error, "Failed to load inventory dashboard"),
        );
      }

      try {
        return ok(mapInventoryDashboard(data));
      } catch {
        return fail("Inventory dashboard response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load inventory dashboard"));
    }
  },
};
