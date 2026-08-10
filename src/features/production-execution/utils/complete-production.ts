/**
 * Pure helpers for Complete Production (PRD-001 / DEV-015 / DEV-103).
 *
 * Pre-transaction: load/validate session + recipe, scale BOM by actual
 * produced quantity (never planned), validate inventory availability,
 * calculate batch costs via Production Cost Calculator.
 * Database mutation stays in the complete_production_session RPC
 * (one DB transaction: inventory transactions → batches → session).
 */

import { roundMoney } from "@/lib/money";
import { addQuantities, roundQuantity } from "@/lib/quantity";
import { scaleRecipeIngredientNeed } from "@/features/production-planning";
import type { ProductionSessionStatus } from "../types/production-session";
import {
  calculateBatchCostSummary,
  roundProductionUnitCost,
  type ProductionCostLine,
  type ProductionCostLineInput,
} from "./production-cost-calculator";

export interface CompleteProductionRecipeIngredient {
  ingredient_id: string;
  quantity_per_yield: number;
  unit: string;
  /**
   * Actual inventory unit cost. null = missing valuation (rejected).
   */
  cost_per_unit: number | null;
  name: string;
  current_stock: number;
  /** True when the recipe references an ingredient row that does not exist. */
  is_missing?: boolean;
}

export interface CompleteProductionRecipeBom {
  recipe_id: string;
  recipe_name: string;
  yield_quantity: number;
  is_active: boolean;
  ingredients: CompleteProductionRecipeIngredient[];
}

export interface CompleteProductionLineInput {
  line_id: string;
  recipe_id: string;
  product_name: string;
  actual_produced_quantity: number;
}

export interface IngredientConsumptionLine {
  ingredient_id: string;
  ingredient_name: string;
  quantity: number;
  unit: string;
  unit_cost: number;
  total_cost: number;
  available_stock: number;
}

export interface ProductionBatchPlan {
  session_line_id: string;
  finished_good_id: string;
  recipe_id: string;
  product_name: string;
  produced_quantity: number;
  unit_cost: number;
  total_cost: number;
  /** Per-ingredient cost breakdown for this batch (DEV-103). */
  cost_breakdown: readonly ProductionCostLine[];
}

export interface CompleteProductionPlan {
  consumptions: IngredientConsumptionLine[];
  batches: ProductionBatchPlan[];
  total_cost: number;
}

export interface ProductionCompletedLogPayload {
  session_id: string;
  batch_ids: string[];
  product_ids: string[];
  produced_quantity: number;
  total_cost: number;
}

export {
  assignFinishedGoodsCostFromBatch,
  calculateBatchCostSummary,
  deriveBatchTotalCost,
  roundProductionUnitCost,
} from "./production-cost-calculator";

export type {
  BatchCostSummary,
  FinishedGoodsCostAssignment,
  ProductionCostLine,
} from "./production-cost-calculator";

/**
 * BR-001 / BR-002: completion allowed only when status = IN_PROGRESS.
 * Completed sessions are immutable (double-complete → domain error).
 */
export function assertCanCompleteProductionSession(
  status: ProductionSessionStatus,
): string | null {
  if (status === "completed") {
    return "This production session is already completed.";
  }

  if (status === "cancelled") {
    return "This production session was cancelled.";
  }

  if (status !== "in_progress") {
    return "Only in-progress production sessions can be completed.";
  }

  return null;
}

/** @deprecated Prefer roundProductionUnitCost from Production Cost Calculator. */
export function roundUnitCost(value: number): number {
  return roundProductionUnitCost(value);
}

/**
 * Build consumption + batch plans from actual produced quantities.
 * Batch costs come only from Production Cost Calculator.
 */
export function buildCompleteProductionPlan(
  lines: readonly CompleteProductionLineInput[],
  bomsByRecipeId: ReadonlyMap<string, CompleteProductionRecipeBom>,
): { ok: true; plan: CompleteProductionPlan } | { ok: false; error: string } {
  const consumptionByIngredient = new Map<
    string,
    {
      ingredient_name: string;
      quantity: number;
      unit: string;
      total_cost: number;
      available_stock: number;
      unit_cost: number;
    }
  >();
  const batches: ProductionBatchPlan[] = [];

  for (const line of lines) {
    if (line.actual_produced_quantity < 0) {
      return { ok: false, error: "Produced quantity cannot be negative." };
    }

    if (line.actual_produced_quantity === 0) {
      continue;
    }

    const bom = bomsByRecipeId.get(line.recipe_id);
    if (!bom) {
      return {
        ok: false,
        error: `Recipe for "${line.product_name}" was not found.`,
      };
    }

    if (!bom.is_active) {
      return {
        ok: false,
        error: `Recipe "${bom.recipe_name}" is inactive and cannot be produced.`,
      };
    }

    if (bom.yield_quantity <= 0) {
      return {
        ok: false,
        error: `Recipe "${bom.recipe_name}" has an invalid yield.`,
      };
    }

    if (bom.ingredients.length === 0) {
      return {
        ok: false,
        error: `Recipe "${bom.recipe_name}" has no ingredients.`,
      };
    }

    const costLineInputs: ProductionCostLineInput[] = [];

    for (const ingredient of bom.ingredients) {
      if (ingredient.is_missing) {
        return {
          ok: false,
          error: `Recipe "${bom.recipe_name}" references a missing ingredient.`,
        };
      }

      const scaled = scaleRecipeIngredientNeed(
        {
          ingredientId: ingredient.ingredient_id,
          quantityPerYield: ingredient.quantity_per_yield,
          unit: ingredient.unit,
        },
        line.actual_produced_quantity,
        bom.yield_quantity,
      );

      if (scaled <= 0) {
        continue;
      }

      costLineInputs.push({
        ingredient_id: ingredient.ingredient_id,
        ingredient_name: ingredient.name,
        consumed_quantity: scaled,
        unit: ingredient.unit,
        inventory_unit_cost: ingredient.cost_per_unit as number,
      });
    }

    const costResult = calculateBatchCostSummary({
      produced_quantity: line.actual_produced_quantity,
      cost_lines: costLineInputs,
    });

    if (!costResult.ok) {
      return { ok: false, error: costResult.error };
    }

    const { summary } = costResult;

    for (const costLine of summary.cost_breakdown) {
      const existing = consumptionByIngredient.get(costLine.ingredient_id);
      if (existing) {
        existing.quantity = addQuantities(
          existing.quantity,
          costLine.consumed_quantity,
        );
        existing.total_cost += costLine.line_cost;
      } else {
        const bomIngredient = bom.ingredients.find(
          (row) => row.ingredient_id === costLine.ingredient_id,
        );
        consumptionByIngredient.set(costLine.ingredient_id, {
          ingredient_name: costLine.ingredient_name,
          quantity: costLine.consumed_quantity,
          unit: costLine.unit,
          total_cost: costLine.line_cost,
          available_stock: bomIngredient?.current_stock ?? 0,
          unit_cost: costLine.inventory_unit_cost,
        });
      }
    }

    batches.push({
      session_line_id: line.line_id,
      finished_good_id: line.recipe_id,
      recipe_id: line.recipe_id,
      product_name: line.product_name,
      produced_quantity: summary.produced_quantity,
      unit_cost: summary.unit_cost,
      total_cost: summary.batch_cost,
      cost_breakdown: summary.cost_breakdown,
    });
  }

  const consumptions: IngredientConsumptionLine[] = [];

  for (const [ingredientId, value] of consumptionByIngredient) {
    const quantity = roundQuantity(value.quantity);
    consumptions.push({
      ingredient_id: ingredientId,
      ingredient_name: value.ingredient_name,
      quantity,
      unit: value.unit,
      unit_cost: roundProductionUnitCost(value.unit_cost),
      total_cost: roundMoney(value.total_cost),
      available_stock: roundQuantity(value.available_stock),
    });
  }

  consumptions.sort((a, b) =>
    a.ingredient_name.localeCompare(b.ingredient_name),
  );

  return {
    ok: true,
    plan: {
      consumptions,
      batches,
      total_cost: roundMoney(
        batches.reduce((sum, batch) => sum + batch.total_cost, 0),
      ),
    },
  };
}

/**
 * Returns a user-facing error when any consumption exceeds available stock.
 * BR-003: inventory must never become negative.
 */
export function validateInventoryForCompletion(
  consumptions: readonly IngredientConsumptionLine[],
): string | null {
  for (const line of consumptions) {
    if (line.quantity > line.available_stock) {
      return `Insufficient stock for "${line.ingredient_name}". Required ${line.quantity}, available ${line.available_stock}.`;
    }
  }

  return null;
}

/**
 * Structured operational log required by PRD-001.
 */
export function logProductionCompleted(
  payload: ProductionCompletedLogPayload,
): void {
  console.info("ProductionCompleted", payload);
}

export function mapCompleteProductionRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("already completed")) {
    return "This production session is already completed.";
  }

  if (normalized.includes("was cancelled")) {
    return "This production session was cancelled.";
  }

  if (normalized.includes("only in-progress")) {
    return "Only in-progress production sessions can be completed.";
  }

  if (normalized.includes("completed by user is required")) {
    return "You must be signed in to finish production.";
  }

  if (normalized.includes("insufficient stock")) {
    return message;
  }

  if (normalized.includes("missing ingredient")) {
    return message;
  }

  if (normalized.includes("missing inventory valuation")) {
    return message;
  }

  if (normalized.includes("can no longer be edited")) {
    return "This production session can no longer be edited.";
  }

  if (normalized.includes("actual produced quantity")) {
    return "Enter an actual produced quantity for every product before finishing.";
  }

  if (
    normalized.includes("could not find the function") ||
    (normalized.includes("complete_production_session") &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883")))
  ) {
    return "Production completion is not available yet. Apply the complete-production database script and try again.";
  }

  return null;
}
