/**
 * Inventory Valuation read service (DEV-058).
 *
 * Reads exclusively via get_inventory_valuation and get_inventory_item_value RPCs.
 * Does NOT mutate data, recalculate stock values, cache, or write tables.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { InventoryValuation } from "../types/inventory-valuation";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function mapInventoryValuationRow(data: unknown): InventoryValuation {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Inventory valuation row is invalid.");
  }

  const row = data as Record<string, unknown>;
  const ingredientId = row.ingredient_id;
  const ingredientName = row.ingredient_name;
  const currentQuantity = toNumber(row.current_quantity);
  const unit = row.unit;
  const averageCost = toNumber(row.average_cost);
  const stockValue = toNumber(row.stock_value);
  const lastPurchaseDate = nullableString(row.last_purchase_date);

  if (typeof ingredientId !== "string" || !UUID_RE.test(ingredientId)) {
    throw new Error("Ingredient id is invalid.");
  }

  if (typeof ingredientName !== "string" || ingredientName.trim().length === 0) {
    throw new Error("Ingredient name is invalid.");
  }

  if (currentQuantity === undefined) {
    throw new Error("Current quantity is invalid.");
  }

  if (typeof unit !== "string" || unit.trim().length === 0) {
    throw new Error("Unit is invalid.");
  }

  if (averageCost === undefined) {
    throw new Error("Average cost is invalid.");
  }

  if (stockValue === undefined) {
    throw new Error("Stock value is invalid.");
  }

  if (lastPurchaseDate === undefined) {
    throw new Error("Last purchase date is invalid.");
  }

  return {
    ingredient_id: ingredientId,
    ingredient_name: ingredientName,
    current_quantity: currentQuantity,
    unit,
    average_cost: averageCost,
    stock_value: stockValue,
    last_purchase_date: lastPurchaseDate,
  };
}

function mapGetInventoryValuationResult(data: unknown): InventoryValuation[] {
  if (!Array.isArray(data)) {
    throw new Error("Inventory valuation response is invalid.");
  }

  return data.map(mapInventoryValuationRow);
}

function mapInventoryValuationRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("ingredient id is required")) {
    return "Ingredient id is required.";
  }

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("get_inventory_valuation") ||
      normalized.includes("get_inventory_item_value") ||
      normalized.includes("inventory_valuation")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883") ||
        normalized.includes("42p01")))
  ) {
    return "Inventory valuation is not available yet. Apply the inventory valuation database script and try again.";
  }

  return null;
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapInventoryValuationRpcError(message) : null;
    },
  });
}

export const inventoryValuationService = {
  /**
   * List inventory valuation rows via get_inventory_valuation RPC.
   * Ordered by ingredient_name ASC in SQL.
   */
  async getInventoryValuation(): Promise<ServiceResult<InventoryValuation[]>> {
    try {
      const { data, error } = await supabase.rpc("get_inventory_valuation");

      if (error) {
        return fail(
          mapReadError(error, "Failed to load inventory valuation"),
        );
      }

      try {
        return ok(mapGetInventoryValuationResult(data));
      } catch {
        return fail("Inventory valuation response was invalid.");
      }
    } catch (error) {
      return fail(
        mapReadError(error, "Failed to load inventory valuation"),
      );
    }
  },

  /**
   * Load one inventory valuation row via get_inventory_item_value RPC.
   */
  async getInventoryItemValue(
    ingredientId: string,
  ): Promise<ServiceResult<InventoryValuation>> {
    try {
      const trimmedId = ingredientId?.trim() ?? "";
      if (!trimmedId || !UUID_RE.test(trimmedId)) {
        return fail("Ingredient id is required.");
      }

      const { data, error } = await supabase.rpc("get_inventory_item_value", {
        p_ingredient_id: trimmedId,
      });

      if (error) {
        return fail(
          mapReadError(error, "Failed to load inventory item value"),
        );
      }

      if (data === null) {
        return fail("Inventory item value was not found.");
      }

      try {
        return ok(mapInventoryValuationRow(data));
      } catch {
        return fail("Inventory item value response was invalid.");
      }
    } catch (error) {
      return fail(
        mapReadError(error, "Failed to load inventory item value"),
      );
    }
  },
};
