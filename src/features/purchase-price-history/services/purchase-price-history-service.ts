/**
 * Purchase Price History read service (DEV-059).
 *
 * Reads exclusively via get_purchase_price_history and
 * get_purchase_price_history_by_ingredient RPCs.
 * Does NOT mutate data, recalculate prices, cache, or write tables.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { PurchasePriceHistory } from "../types/purchase-price-history";

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

function mapPurchasePriceHistoryRow(data: unknown): PurchasePriceHistory {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Purchase price history row is invalid.");
  }

  const row = data as Record<string, unknown>;
  const ingredientId = row.ingredient_id;
  const ingredientName = row.ingredient_name;
  const supplierName = row.supplier_name;
  const purchaseDate = row.purchase_date;
  const quantity = toNumber(row.quantity);
  const unitPrice = toNumber(row.unit_price);
  const totalPrice = toNumber(row.total_price);

  if (typeof ingredientId !== "string" || !UUID_RE.test(ingredientId)) {
    throw new Error("Ingredient id is invalid.");
  }

  if (typeof ingredientName !== "string" || ingredientName.trim().length === 0) {
    throw new Error("Ingredient name is invalid.");
  }

  if (typeof supplierName !== "string" || supplierName.trim().length === 0) {
    throw new Error("Supplier name is invalid.");
  }

  if (typeof purchaseDate !== "string") {
    throw new Error("Purchase date is invalid.");
  }

  if (quantity === undefined) {
    throw new Error("Quantity is invalid.");
  }

  if (unitPrice === undefined) {
    throw new Error("Unit price is invalid.");
  }

  if (totalPrice === undefined) {
    throw new Error("Total price is invalid.");
  }

  return {
    ingredient_id: ingredientId,
    ingredient_name: ingredientName,
    supplier_name: supplierName,
    purchase_date: purchaseDate,
    quantity,
    unit_price: unitPrice,
    total_price: totalPrice,
  };
}

function mapPurchasePriceHistoryResult(data: unknown): PurchasePriceHistory[] {
  if (!Array.isArray(data)) {
    throw new Error("Purchase price history response is invalid.");
  }

  return data.map(mapPurchasePriceHistoryRow);
}

function mapPurchasePriceHistoryRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("ingredient id is required")) {
    return "Ingredient id is required.";
  }

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("get_purchase_price_history") ||
      normalized.includes("get_purchase_price_history_by_ingredient") ||
      normalized.includes("purchase_price_history")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883") ||
        normalized.includes("42p01")))
  ) {
    return "Purchase price history is not available yet. Apply the purchase price history database script and try again.";
  }

  return null;
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapPurchasePriceHistoryRpcError(message) : null;
    },
  });
}

export const purchasePriceHistoryService = {
  /**
   * List purchase price history rows via get_purchase_price_history RPC.
   * Ordered by purchase_date DESC in SQL.
   */
  async getPurchasePriceHistory(): Promise<
    ServiceResult<PurchasePriceHistory[]>
  > {
    try {
      const { data, error } = await supabase.rpc("get_purchase_price_history");

      if (error) {
        return fail(
          mapReadError(error, "Failed to load purchase price history"),
        );
      }

      try {
        return ok(mapPurchasePriceHistoryResult(data));
      } catch {
        return fail("Purchase price history response was invalid.");
      }
    } catch (error) {
      return fail(
        mapReadError(error, "Failed to load purchase price history"),
      );
    }
  },

  /**
   * List purchase price history rows for one ingredient via
   * get_purchase_price_history_by_ingredient RPC.
   */
  async getPurchasePriceHistoryByIngredient(
    ingredientId: string,
  ): Promise<ServiceResult<PurchasePriceHistory[]>> {
    try {
      const trimmedId = ingredientId?.trim() ?? "";
      if (!trimmedId || !UUID_RE.test(trimmedId)) {
        return fail("Ingredient id is required.");
      }

      const { data, error } = await supabase.rpc(
        "get_purchase_price_history_by_ingredient",
        {
          p_ingredient_id: trimmedId,
        },
      );

      if (error) {
        return fail(
          mapReadError(error, "Failed to load purchase price history"),
        );
      }

      try {
        return ok(mapPurchasePriceHistoryResult(data));
      } catch {
        return fail("Purchase price history response was invalid.");
      }
    } catch (error) {
      return fail(
        mapReadError(error, "Failed to load purchase price history"),
      );
    }
  },
};
