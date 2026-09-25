/**
 * Inventory adjustment operational service.
 *
 * recordAdjustment wraps record_inventory_adjustment (sql/125).
 * Quantity only — never writes cost_per_unit. No journal in this path.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import {
  INVENTORY_ADJUSTMENT_DIRECTIONS,
  INVENTORY_ADJUSTMENT_REASONS,
  type InventoryAdjustmentDirection,
  type InventoryAdjustmentReason,
  type RecordInventoryAdjustmentInput,
  type RecordInventoryAdjustmentResult,
} from "../types/inventory-adjustment";

const FALLBACK_ERROR = "Failed to adjust stock.";

const BELOW_ZERO_PATTERN = /cannot decrease stock below zero/i;
const AVAILABLE_PATTERN = /available\s+([0-9]+(?:\.[0-9]+)?)/i;
const PERMISSION_PATTERN =
  /insufficient permissions for this action \(role:/i;

function isAdjustmentDirection(
  value: string,
): value is InventoryAdjustmentDirection {
  return (INVENTORY_ADJUSTMENT_DIRECTIONS as readonly string[]).includes(value);
}

function isAdjustmentReason(
  value: string,
): value is InventoryAdjustmentReason {
  return (INVENTORY_ADJUSTMENT_REASONS as readonly string[]).includes(value);
}

function readErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return "";
}

export function mapInventoryAdjustmentError(error: unknown): string | null {
  const message = readErrorMessage(error);

  if (BELOW_ZERO_PATTERN.test(message)) {
    const available = AVAILABLE_PATTERN.exec(message)?.[1];
    return available
      ? `Not enough stock for this decrease. Available: ${available}.`
      : "Not enough stock for this decrease.";
  }

  if (PERMISSION_PATTERN.test(message)) {
    return "You don't have permission to adjust stock.";
  }

  return null;
}

export const inventoryAdjustmentService = {
  async recordAdjustment(
    input: RecordInventoryAdjustmentInput,
  ): Promise<ServiceResult<RecordInventoryAdjustmentResult>> {
    try {
      if (!input.ingredientId.trim()) {
        return fail("Select an ingredient to adjust.");
      }

      if (!isAdjustmentDirection(input.direction)) {
        return fail("Choose whether to increase or decrease stock.");
      }

      if (!(input.quantity > 0) || !Number.isFinite(input.quantity)) {
        return fail("Adjustment quantity must be greater than zero.");
      }

      if (!isAdjustmentReason(input.reason)) {
        return fail("Adjustment reason is invalid.");
      }

      const { data, error } = await supabase.rpc(
        "record_inventory_adjustment",
        {
          p_ingredient_id: input.ingredientId,
          p_direction: input.direction,
          p_quantity: input.quantity,
          p_reason: input.reason,
          p_note: input.note?.trim() ? input.note.trim() : null,
        },
      );

      if (error || !data) {
        return fail(
          toUserError(error, FALLBACK_ERROR, {
            map: mapInventoryAdjustmentError,
          }),
        );
      }

      return ok(data as RecordInventoryAdjustmentResult);
    } catch (error) {
      return fail(
        toUserError(error, FALLBACK_ERROR, {
          map: mapInventoryAdjustmentError,
        }),
      );
    }
  },
};
