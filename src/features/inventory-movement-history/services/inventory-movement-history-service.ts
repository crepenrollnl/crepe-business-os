/**
 * Inventory Movement History read service (DEV-062).
 *
 * Reads exclusively via get_inventory_movement_history and
 * get_inventory_movement_history_by_ingredient RPCs.
 * Does NOT mutate data, recalculate quantities, cache, or write tables.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { InventoryMovementHistory } from "../types/inventory-movement-history";

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

function nullableUuid(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "string" && UUID_RE.test(value)) {
    return value;
  }
  return undefined;
}

function mapInventoryMovementHistoryRow(
  data: unknown,
): InventoryMovementHistory {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Inventory movement history row is invalid.");
  }

  const row = data as Record<string, unknown>;
  const movementId = row.movement_id;
  const ingredientId = row.ingredient_id;
  const ingredientName = row.ingredient_name;
  const movementType = row.movement_type;
  const quantity = toNumber(row.quantity);
  const unit = row.unit;
  const sourceType = row.source_type;
  const sourceId = nullableUuid(row.source_id);
  const occurredAt = row.occurred_at;

  if (typeof movementId !== "string" || !UUID_RE.test(movementId)) {
    throw new Error("Movement id is invalid.");
  }

  if (typeof ingredientId !== "string" || !UUID_RE.test(ingredientId)) {
    throw new Error("Ingredient id is invalid.");
  }

  if (typeof ingredientName !== "string" || ingredientName.trim().length === 0) {
    throw new Error("Ingredient name is invalid.");
  }

  if (typeof movementType !== "string" || movementType.trim().length === 0) {
    throw new Error("Movement type is invalid.");
  }

  if (quantity === undefined) {
    throw new Error("Quantity is invalid.");
  }

  if (typeof unit !== "string" || unit.trim().length === 0) {
    throw new Error("Unit is invalid.");
  }

  if (typeof sourceType !== "string" || sourceType.trim().length === 0) {
    throw new Error("Source type is invalid.");
  }

  if (sourceId === undefined) {
    throw new Error("Source id is invalid.");
  }

  if (typeof occurredAt !== "string") {
    throw new Error("Occurred at is invalid.");
  }

  return {
    movement_id: movementId,
    ingredient_id: ingredientId,
    ingredient_name: ingredientName,
    movement_type: movementType,
    quantity,
    unit,
    source_type: sourceType,
    source_id: sourceId,
    occurred_at: occurredAt,
  };
}

function mapInventoryMovementHistoryResult(
  data: unknown,
): InventoryMovementHistory[] {
  if (!Array.isArray(data)) {
    throw new Error("Inventory movement history response is invalid.");
  }

  return data.map(mapInventoryMovementHistoryRow);
}

function mapInventoryMovementHistoryRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("ingredient id is required")) {
    return "Ingredient id is required.";
  }

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("get_inventory_movement_history") ||
      normalized.includes("get_inventory_movement_history_by_ingredient") ||
      normalized.includes("inventory_movement_history")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883") ||
        normalized.includes("42p01")))
  ) {
    return "Inventory movement history is not available yet. Apply the inventory movement history database script and try again.";
  }

  return null;
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapInventoryMovementHistoryRpcError(message) : null;
    },
  });
}

export const inventoryMovementHistoryService = {
  /**
   * List inventory movement history rows via get_inventory_movement_history RPC.
   * Ordered by occurred_at DESC in SQL.
   */
  async getInventoryMovementHistory(): Promise<
    ServiceResult<InventoryMovementHistory[]>
  > {
    try {
      const { data, error } = await supabase.rpc(
        "get_inventory_movement_history",
      );

      if (error) {
        return fail(
          mapReadError(error, "Failed to load inventory movement history"),
        );
      }

      try {
        return ok(mapInventoryMovementHistoryResult(data));
      } catch {
        return fail("Inventory movement history response was invalid.");
      }
    } catch (error) {
      return fail(
        mapReadError(error, "Failed to load inventory movement history"),
      );
    }
  },

  /**
   * List inventory movement history rows for one ingredient via
   * get_inventory_movement_history_by_ingredient RPC.
   */
  async getInventoryMovementHistoryByIngredient(
    ingredientId: string,
  ): Promise<ServiceResult<InventoryMovementHistory[]>> {
    try {
      const trimmedId = ingredientId?.trim() ?? "";
      if (!trimmedId || !UUID_RE.test(trimmedId)) {
        return fail("Ingredient id is required.");
      }

      const { data, error } = await supabase.rpc(
        "get_inventory_movement_history_by_ingredient",
        {
          p_ingredient_id: trimmedId,
        },
      );

      if (error) {
        return fail(
          mapReadError(error, "Failed to load inventory movement history"),
        );
      }

      try {
        return ok(mapInventoryMovementHistoryResult(data));
      } catch {
        return fail("Inventory movement history response was invalid.");
      }
    } catch (error) {
      return fail(
        mapReadError(error, "Failed to load inventory movement history"),
      );
    }
  },
};
