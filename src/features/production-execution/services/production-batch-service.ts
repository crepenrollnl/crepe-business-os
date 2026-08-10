/**
 * Production Batch service (DEV-015 / DEV-103).
 *
 * Read-only access to immutable production batches created on session completion.
 * Never updates or deletes batches. Never recalculates frozen unit_cost.
 *
 * Cost breakdown is reconstructed from:
 *   - frozen production_out stock_movements unit costs (actual inventory values)
 *   - BOM scaled by batch produced quantity (actual consumption quantities)
 */

import { finishedGoodsReadService } from "@/features/finished-goods/services/finished-goods-read-service";
import { assignFinishedGoodsInventoryValuation } from "@/features/finished-goods/utils/finished-goods-valuation";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { scaleRecipeIngredientNeed } from "@/features/production-planning";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  ProductionBatch,
  ProductionBatchWithProduct,
} from "../types/production-batch";
import {
  buildProductionCostLines,
  deriveBatchTotalCost,
  type ProductionCostLine,
} from "../utils/production-cost-calculator";

interface ProductionBatchRow {
  id: string;
  batch_number: number;
  production_session_id: string;
  production_session_line_id: string;
  finished_good_id: string;
  recipe_id: string;
  produced_quantity: number | string;
  unit_cost: number | string;
  produced_at: string;
  created_at: string;
}

interface StockMovementCostRow {
  ingredient_id: string;
  unit_cost: number | string | null;
}

interface RecipeYieldRow {
  id: string;
  yield_quantity: number | string;
}

interface RecipeItemRow {
  recipe_id: string;
  ingredient_id: string;
  quantity: number | string;
  unit: string;
}

interface IngredientNameRow {
  id: string;
  name: string;
  unit: string;
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function mapBatch(row: ProductionBatchRow): ProductionBatch {
  return {
    id: row.id,
    batch_number: row.batch_number,
    production_session_id: row.production_session_id,
    production_session_line_id: row.production_session_line_id,
    finished_good_id: row.finished_good_id,
    recipe_id: row.recipe_id,
    produced_quantity: toNumber(row.produced_quantity),
    unit_cost: toNumber(row.unit_cost),
    produced_at: row.produced_at,
    created_at: row.created_at,
  };
}

async function loadFrozenIngredientUnitCosts(
  sessionId: string,
): Promise<ServiceResult<Map<string, number>>> {
  const { data, error } = await supabase
    .from("stock_movements")
    .select("ingredient_id, unit_cost")
    .eq("reference_type", "production_session")
    .eq("reference_id", sessionId)
    .eq("movement_type", "production_out");

  if (error) {
    return fail(
      toUserError(error, "Failed to load production consumption costs"),
    );
  }

  const map = new Map<string, number>();
  for (const row of (data as StockMovementCostRow[] | null) ?? []) {
    if (!row.ingredient_id || row.unit_cost === null) {
      continue;
    }
    map.set(row.ingredient_id, toNumber(row.unit_cost));
  }

  return ok(map);
}

async function buildCostBreakdownsForBatches(
  sessionId: string,
  batches: readonly ProductionBatch[],
): Promise<ServiceResult<Map<string, readonly ProductionCostLine[]>>> {
  const empty = new Map<string, readonly ProductionCostLine[]>();

  if (batches.length === 0) {
    return ok(empty);
  }

  const frozenCostsResult = await loadFrozenIngredientUnitCosts(sessionId);
  if (frozenCostsResult.error || !frozenCostsResult.data) {
    // Breakdown is optional for display — batches still load with totals.
    return ok(empty);
  }

  const frozenCosts = frozenCostsResult.data;
  if (frozenCosts.size === 0) {
    return ok(empty);
  }

  const recipeIds = [...new Set(batches.map((batch) => batch.recipe_id))];

  const [recipesResult, itemsResult] = await Promise.all([
    supabase.from("recipes").select("id, yield_quantity").in("id", recipeIds),
    supabase
      .from("recipe_items")
      .select("recipe_id, ingredient_id, quantity, unit")
      .in("recipe_id", recipeIds),
  ]);

  if (recipesResult.error || itemsResult.error) {
    return ok(empty);
  }

  const recipeYields = new Map(
    ((recipesResult.data as RecipeYieldRow[] | null) ?? []).map((row) => [
      row.id,
      toNumber(row.yield_quantity),
    ]),
  );

  const items = (itemsResult.data as RecipeItemRow[] | null) ?? [];
  const ingredientIds = [...new Set(items.map((item) => item.ingredient_id))];

  let ingredientNames = new Map<string, { name: string; unit: string }>();
  if (ingredientIds.length > 0) {
    const namesResult = await supabase
      .from("ingredients")
      .select("id, name, unit")
      .in("id", ingredientIds);

    if (!namesResult.error) {
      ingredientNames = new Map(
        ((namesResult.data as IngredientNameRow[] | null) ?? []).map((row) => [
          row.id,
          { name: row.name, unit: row.unit },
        ]),
      );
    }
  }

  const itemsByRecipe = new Map<string, RecipeItemRow[]>();
  for (const item of items) {
    const existing = itemsByRecipe.get(item.recipe_id) ?? [];
    existing.push(item);
    itemsByRecipe.set(item.recipe_id, existing);
  }

  const breakdowns = new Map<string, readonly ProductionCostLine[]>();

  for (const batch of batches) {
    const yieldQuantity = recipeYields.get(batch.recipe_id);
    const recipeItems = itemsByRecipe.get(batch.recipe_id) ?? [];

    if (!yieldQuantity || yieldQuantity <= 0 || recipeItems.length === 0) {
      breakdowns.set(batch.id, []);
      continue;
    }

    const costInputs = recipeItems.map((item) => {
      const meta = ingredientNames.get(item.ingredient_id);
      const consumed = scaleRecipeIngredientNeed(
        {
          ingredientId: item.ingredient_id,
          quantityPerYield: toNumber(item.quantity),
          unit: meta?.unit ?? item.unit,
        },
        batch.produced_quantity,
        yieldQuantity,
      );

      return {
        ingredient_id: item.ingredient_id,
        ingredient_name: meta?.name ?? "Ingredient",
        consumed_quantity: consumed,
        unit: meta?.unit ?? item.unit,
        inventory_unit_cost: frozenCosts.get(item.ingredient_id) ?? Number.NaN,
      };
    });

    const linesResult = buildProductionCostLines(costInputs);
    breakdowns.set(batch.id, linesResult.ok ? linesResult.lines : []);
  }

  return ok(breakdowns);
}

export const productionBatchService = {
  async listBySessionId(
    sessionId: string,
  ): Promise<ServiceResult<ProductionBatchWithProduct[]>> {
    try {
      const { data, error } = await supabase
        .from("production_batches")
        .select(
          "id, batch_number, production_session_id, production_session_line_id, finished_good_id, recipe_id, produced_quantity, unit_cost, produced_at, created_at",
        )
        .eq("production_session_id", sessionId)
        .order("batch_number", { ascending: true });

      if (error) {
        return fail(toUserError(error, "Failed to load production batches"));
      }

      const batches =
        (data as ProductionBatchRow[] | null)?.map(mapBatch) ?? [];

      if (batches.length === 0) {
        return ok([]);
      }

      const lineIds = batches.map((batch) => batch.production_session_line_id);
      const { data: lines, error: linesError } = await supabase
        .from("production_session_lines")
        .select("id, product_name, yield_unit")
        .in("id", lineIds);

      if (linesError) {
        return fail(
          toUserError(linesError, "Failed to load production batch details"),
        );
      }

      const lineMap = new Map(
        (
          (lines as Array<{
            id: string;
            product_name: string;
            yield_unit: string;
          }> | null) ?? []
        ).map((line) => [line.id, line]),
      );

      const breakdownsResult = await buildCostBreakdownsForBatches(
        sessionId,
        batches,
      );
      const breakdowns = breakdownsResult.data ?? new Map();

      const valuationResult =
        await finishedGoodsReadService.listAvailableBatchesByIds(
          batches.map((batch) => batch.id),
        );
      const valuationByBatchId = new Map(
        (valuationResult.data ?? []).map((row) => [row.production_batch_id, row]),
      );

      return ok(
        batches.map((batch) => {
          const line = lineMap.get(batch.production_session_line_id);
          const availability = valuationByBatchId.get(batch.id);
          const valuation = availability
            ? assignFinishedGoodsInventoryValuation({
                production_batch_id: availability.production_batch_id,
                produced_quantity: availability.produced_quantity,
                available_quantity: availability.available_quantity,
                unit_cost: availability.unit_cost,
                total_batch_cost: availability.total_batch_cost,
                remaining_value: availability.remaining_value,
              })
            : null;

          const hasValuation =
            valuation?.ok === true ||
            (Number.isFinite(batch.unit_cost) && batch.unit_cost >= 0);

          return {
            ...batch,
            product_name: line?.product_name ?? "Finished good",
            yield_unit: line?.yield_unit ?? "",
            total_cost: hasValuation
              ? valuation?.ok
                ? valuation.valuation.total_batch_cost
                : deriveBatchTotalCost(
                    batch.produced_quantity,
                    batch.unit_cost,
                  )
              : 0,
            cost_breakdown: breakdowns.get(batch.id) ?? [],
            remaining_quantity: valuation?.ok
              ? valuation.valuation.remaining_quantity
              : null,
            remaining_value: valuation?.ok
              ? valuation.valuation.remaining_value
              : null,
            has_valuation: hasValuation,
          };
        }),
      );
    } catch (error) {
      return fail(toUserError(error, "Failed to load production batches"));
    }
  },
};
