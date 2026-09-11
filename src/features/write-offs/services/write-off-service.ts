/**
 * Write-off operational service.
 *
 * recordWriteOff wraps record_write_off (sql/115) — physical stock only.
 * Journals are posted afterwards by write-off-accounting-service.
 */

import { finishedGoodsListService } from "@/features/finished-goods/services/finished-goods-list-service";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  RecordWriteOffInput,
  RecordWriteOffRpcResult,
  WriteOffIngredientOption,
  WriteOffProductOption,
  WriteOffRecord,
} from "../types/write-off";
import {
  WRITE_OFF_ITEM_TYPES,
  WRITE_OFF_REASONS,
} from "../types/write-off";

interface WriteOffRow {
  id: string;
  item_type: WriteOffRecord["item_type"];
  ingredient_id: string | null;
  product_id: string | null;
  quantity: number;
  unit_cost: number;
  total_value: number;
  reason: WriteOffRecord["reason"];
  note: string | null;
  created_by: string | null;
  created_at: string;
}

function isWriteOffItemType(
  value: string,
): value is RecordWriteOffInput["itemType"] {
  return (WRITE_OFF_ITEM_TYPES as readonly string[]).includes(value);
}

function isWriteOffReason(
  value: string,
): value is RecordWriteOffInput["reason"] {
  return (WRITE_OFF_REASONS as readonly string[]).includes(value);
}

export const writeOffService = {
  async recordWriteOff(
    input: RecordWriteOffInput,
  ): Promise<ServiceResult<RecordWriteOffRpcResult>> {
    try {
      if (!isWriteOffItemType(input.itemType)) {
        return fail("Write-off item type must be ingredient or finished good.");
      }

      if (!isWriteOffReason(input.reason)) {
        return fail("Write-off reason is invalid.");
      }

      if (!(input.quantity > 0) || !Number.isFinite(input.quantity)) {
        return fail("Write-off quantity must be greater than zero.");
      }

      if (input.itemType === "ingredient" && !input.ingredientId?.trim()) {
        return fail("Select an ingredient to write off.");
      }

      if (input.itemType === "finished_good" && !input.productId?.trim()) {
        return fail("Select a finished good to write off.");
      }

      const { data, error } = await supabase.rpc("record_write_off", {
        p_item_type: input.itemType,
        p_ingredient_id:
          input.itemType === "ingredient" ? input.ingredientId : null,
        p_product_id:
          input.itemType === "finished_good" ? input.productId : null,
        p_quantity: input.quantity,
        p_reason: input.reason,
        p_note: input.note?.trim() ? input.note.trim() : null,
      });

      if (error || !data) {
        return fail(toUserError(error, "Failed to record write-off."));
      }

      return ok(data as RecordWriteOffRpcResult);
    } catch (error) {
      return fail(toUserError(error, "Failed to record write-off."));
    }
  },

  async listWriteOffs(): Promise<ServiceResult<WriteOffRecord[]>> {
    try {
      const { data, error } = await supabase
        .from("write_offs")
        .select(
          "id, item_type, ingredient_id, product_id, quantity, unit_cost, total_value, reason, note, created_by, created_at",
        )
        .order("created_at", { ascending: false });

      if (error) {
        return fail(toUserError(error, "Failed to load write-offs."));
      }

      const rows = (data ?? []) as WriteOffRow[];
      const ingredientIds = [
        ...new Set(
          rows
            .map((row) => row.ingredient_id)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const productIds = [
        ...new Set(
          rows
            .map((row) => row.product_id)
            .filter((id): id is string => Boolean(id)),
        ),
      ];

      const [ingredientsResult, recipesResult] = await Promise.all([
        ingredientIds.length > 0
          ? supabase.from("ingredients").select("id, name").in("id", ingredientIds)
          : Promise.resolve({ data: [], error: null }),
        productIds.length > 0
          ? supabase.from("recipes").select("id, name").in("id", productIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (ingredientsResult.error) {
        return fail(
          toUserError(ingredientsResult.error, "Failed to load ingredients."),
        );
      }

      if (recipesResult.error) {
        return fail(toUserError(recipesResult.error, "Failed to load products."));
      }

      const ingredientNames = new Map(
        (ingredientsResult.data ?? []).map((row) => [
          row.id as string,
          row.name as string,
        ]),
      );
      const recipeNames = new Map(
        (recipesResult.data ?? []).map((row) => [
          row.id as string,
          row.name as string,
        ]),
      );

      return ok(
        rows.map((row) => ({
          ...row,
          item_name:
            row.item_type === "ingredient"
              ? (ingredientNames.get(row.ingredient_id ?? "") ?? null)
              : (recipeNames.get(row.product_id ?? "") ?? null),
        })),
      );
    } catch (error) {
      return fail(toUserError(error, "Failed to load write-offs."));
    }
  },

  async listIngredientOptions(): Promise<
    ServiceResult<WriteOffIngredientOption[]>
  > {
    try {
      const { data, error } = await supabase
        .from("ingredients")
        .select("id, name, unit")
        .order("name");

      if (error) {
        return fail(toUserError(error, "Failed to load ingredients."));
      }

      return ok((data ?? []) as WriteOffIngredientOption[]);
    } catch (error) {
      return fail(toUserError(error, "Failed to load ingredients."));
    }
  },

  /**
   * Same product set as Inventory → Finished Goods, limited to remaining > 0.
   */
  async listProductOptions(): Promise<ServiceResult<WriteOffProductOption[]>> {
    const availability = await finishedGoodsListService.listProductAvailability();
    if (availability.error || !availability.data) {
      return fail(availability.error ?? "Failed to load finished goods.");
    }

    const options = availability.data
      .filter((row) => row.available_quantity > 0)
      .map((row) => ({
        id: row.product_id,
        name: row.product_name ?? "—",
        unit: row.yield_unit,
      }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );

    return ok(options);
  },
};
