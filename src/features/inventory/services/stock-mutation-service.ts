/**
 * Shared inventory stock mutation primitives.
 *
 * Purchases increase stock via increment_ingredient_stock.
 * Production Execution decreases stock only through
 * complete_production_session (no public client decrement helper — DEV-017).
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";

function isMissingRpcError(error: unknown, functionName: string): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code =
    "code" in error && typeof (error as { code: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";
  const message =
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
      ? (error as { message: string }).message.toLowerCase()
      : "";

  return (
    code === "42883" ||
    message.includes(functionName.toLowerCase()) ||
    message.includes("could not find the function")
  );
}

/**
 * Increase raw-material stock (Purchases receive path).
 */
export async function increaseIngredientStock(
  ingredientId: string,
  quantity: number,
): Promise<ServiceResult<null>> {
  if (!(quantity > 0)) {
    return fail("Stock increase quantity must be greater than zero");
  }

  const { error } = await supabase.rpc("increment_ingredient_stock", {
    p_ingredient_id: ingredientId,
    p_quantity: quantity,
  });

  if (!error) {
    return ok(null);
  }

  if (isMissingRpcError(error, "increment_ingredient_stock")) {
    return fail(
      "Inventory stock update is not available. Apply the purchases database script and try again.",
    );
  }

  return fail(toUserError(error, "Failed to update inventory stock"));
}
