/**
 * Sales COGS service (DEV-108).
 *
 * Builds frozen sale cost summaries from two append-only ledgers a
 * completed sale can draw from (sql/089):
 *   - finished_goods_batch_consumptions — FIFO consumption of a
 *     component_recipe_id part of an assembly.
 *   - stock_movements (reference_type='sale', movement_type='sale_out') —
 *     direct decrement of an ingredient_id part of an assembly (raw,
 *     no-cook add-ins that never go through Production).
 * Never recalculates unit costs. Never posts Accounting. Never calculates
 * profit. This service only assembles the frozen sale valuation read model.
 */

import { finishedGoodsReadService } from "@/features/finished-goods/services/finished-goods-read-service";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { SaleCogsBatchLayer, SaleCostSummary } from "../types/sale-cogs";
import { isCompletedSaleStatus } from "../utils/is-completed-sale-status";
import {
  assertSaleCogsImmutable,
  buildSaleCostSummary,
} from "../utils/sale-cogs-builder";
import { salesReadService } from "./sales-read-service";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mapFinishedGoodsLayers(
  rows: NonNullable<
    Awaited<
      ReturnType<typeof finishedGoodsReadService.listConsumptionsForSaleLines>
    >["data"]
  >,
): SaleCogsBatchLayer[] {
  return rows.map((row) => ({
    consumption_id: row.consumption_id,
    sale_line_id: row.sale_line_id,
    production_batch_id: row.production_batch_id,
    batch_number: row.batch_number,
    quantity: row.quantity,
    unit_cost: row.unit_cost,
    total_cost: row.total_cost,
    produced_at: row.produced_at,
    source: "finished_goods",
    ingredient_id: null,
    ingredient_name: null,
  }));
}

type IngredientConsumptionRow = {
  id: string;
  ingredient_id: string;
  quantity: number | string;
  unit_cost: number | string;
  reference_id: string;
  ingredients: { name: string } | { name: string }[] | null;
};

function ingredientNameOf(
  ingredients: IngredientConsumptionRow["ingredients"],
): string | null {
  if (Array.isArray(ingredients)) {
    return ingredients[0]?.name ?? null;
  }
  return ingredients?.name ?? null;
}

/**
 * Load direct raw-ingredient sale consumption layers (sql/089) — the
 * counterpart to finishedGoodsReadService.listConsumptionsForSaleLines for
 * the ingredient_id branch of an assembly. Same reference_type/
 * movement_type filter confirm_sale itself writes with, so this read can
 * never pick up an unrelated stock_movements row.
 */
async function listIngredientConsumptionsForSaleLines(
  saleLineIds: readonly string[],
): Promise<ServiceResult<SaleCogsBatchLayer[]>> {
  try {
    const ids = [
      ...new Set(saleLineIds.map((id) => id.trim()).filter(Boolean)),
    ];
    if (ids.length === 0) {
      return ok([]);
    }

    const { data, error } = await supabase
      .from("stock_movements")
      .select(
        "id, ingredient_id, quantity, unit_cost, reference_id, ingredients ( name )",
      )
      .eq("reference_type", "sale")
      .eq("movement_type", "sale_out")
      .in("reference_id", ids)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (error) {
      return fail(
        toUserError(error, "Failed to load ingredient sale consumptions"),
      );
    }

    const rows = (data ?? []) as IngredientConsumptionRow[];

    return ok(
      rows.map((row) => {
        const quantity = Number(row.quantity);
        const unitCost = Number(row.unit_cost);

        return {
          consumption_id: row.id,
          sale_line_id: row.reference_id,
          production_batch_id: null,
          batch_number: null,
          quantity,
          unit_cost: unitCost,
          total_cost: quantity * unitCost,
          produced_at: null,
          source: "ingredient",
          ingredient_id: row.ingredient_id,
          ingredient_name: ingredientNameOf(row.ingredients),
        };
      }),
    );
  } catch (error) {
    return fail(
      toUserError(error, "Failed to load ingredient sale consumptions"),
    );
  }
}

export const saleCogsService = {
  buildSaleCostSummary,
  assertSaleCogsImmutable,

  /**
   * Load frozen COGS for a completed sale from Finished Goods consumptions.
   * Idempotent: re-reading the same ledger yields the same frozen summary.
   */
  async getSaleCostSummary(
    saleId: string,
  ): Promise<ServiceResult<SaleCostSummary>> {
    try {
      const trimmed = saleId?.trim() ?? "";
      if (!trimmed || !UUID_RE.test(trimmed)) {
        return fail("Sale id is required.");
      }

      const saleResult = await salesReadService.getSale(trimmed);
      if (saleResult.error || !saleResult.data) {
        return fail(saleResult.error ?? "Failed to load sale");
      }

      const sale = saleResult.data;

      if (!isCompletedSaleStatus(sale.status)) {
        if (sale.status === "draft") {
          return fail("Draft sales do not have frozen COGS yet.");
        }
        return fail("Sale has no Finished Goods consumption layers for COGS.");
      }

      const lineIds = sale.lines.map((line) => line.line_id);
      const [finishedGoodsResult, ingredientResult] = await Promise.all([
        finishedGoodsReadService.listConsumptionsForSaleLines(lineIds),
        listIngredientConsumptionsForSaleLines(lineIds),
      ]);

      if (finishedGoodsResult.error || !finishedGoodsResult.data) {
        return fail(
          finishedGoodsResult.error ??
            "Failed to load finished goods sale consumptions",
        );
      }

      if (ingredientResult.error || !ingredientResult.data) {
        return fail(
          ingredientResult.error ??
            "Failed to load ingredient sale consumptions",
        );
      }

      const built = buildSaleCostSummary({
        sale_id: sale.sale_id,
        sale_status: sale.status,
        layers: [
          ...mapFinishedGoodsLayers(finishedGoodsResult.data),
          ...ingredientResult.data,
        ],
      });

      if (!built.ok) {
        return fail(built.error);
      }

      return ok(built.summary);
    } catch (error) {
      return fail(toUserError(error, "Failed to load sale COGS"));
    }
  },

  /**
   * Explicit frozen valuation build after sale completion.
   * Same read path as getSaleCostSummary — ledger is the store.
   */
  async buildFrozenSaleValuation(
    saleId: string,
  ): Promise<ServiceResult<SaleCostSummary>> {
    return this.getSaleCostSummary(saleId);
  },
};
