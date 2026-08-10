/**
 * Recipe Cost Analysis read service (DEV-057).
 *
 * Reads exclusively via get_recipe_cost_analysis and get_recipe_cost RPCs.
 * Does NOT mutate data, recalculate costs, cache, or write tables.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { RecipeCostAnalysis } from "../types/recipe-cost-analysis";

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

function toNullableNumber(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  return toNumber(value);
}

function mapRecipeCostAnalysisRow(data: unknown): RecipeCostAnalysis {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Recipe cost analysis row is invalid.");
  }

  const row = data as Record<string, unknown>;
  const recipeId = row.recipe_id;
  const recipeName = row.recipe_name;
  const totalCost = toNumber(row.total_cost);
  const ingredientCount = toNumber(row.ingredient_count);
  const lastCostUpdate = row.last_cost_update;
  const costPerPortion = toNullableNumber(row.cost_per_portion);

  if (typeof recipeId !== "string" || !UUID_RE.test(recipeId)) {
    throw new Error("Recipe id is invalid.");
  }

  if (typeof recipeName !== "string" || recipeName.trim().length === 0) {
    throw new Error("Recipe name is invalid.");
  }

  if (totalCost === undefined) {
    throw new Error("Total cost is invalid.");
  }

  if (
    ingredientCount === undefined ||
    !Number.isInteger(ingredientCount) ||
    ingredientCount < 0
  ) {
    throw new Error("Ingredient count is invalid.");
  }

  if (typeof lastCostUpdate !== "string") {
    throw new Error("Last cost update is invalid.");
  }

  if (costPerPortion === undefined) {
    throw new Error("Cost per portion is invalid.");
  }

  return {
    recipe_id: recipeId,
    recipe_name: recipeName,
    total_cost: totalCost,
    ingredient_count: ingredientCount,
    last_cost_update: lastCostUpdate,
    cost_per_portion: costPerPortion,
  };
}

function mapGetRecipeCostAnalysisResult(data: unknown): RecipeCostAnalysis[] {
  if (!Array.isArray(data)) {
    throw new Error("Recipe cost analysis response is invalid.");
  }

  return data.map(mapRecipeCostAnalysisRow);
}

function mapRecipeCostAnalysisRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("recipe id is required")) {
    return "Recipe id is required.";
  }

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("get_recipe_cost_analysis") ||
      normalized.includes("get_recipe_cost") ||
      normalized.includes("recipe_cost_analysis")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883") ||
        normalized.includes("42p01")))
  ) {
    return "Recipe cost analysis is not available yet. Apply the recipe cost analysis database script and try again.";
  }

  return null;
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapRecipeCostAnalysisRpcError(message) : null;
    },
  });
}

export const recipeCostAnalysisService = {
  /**
   * List recipe cost analysis rows via get_recipe_cost_analysis RPC.
   * Ordered by recipe_name ASC in SQL.
   */
  async getRecipeCostAnalysis(): Promise<ServiceResult<RecipeCostAnalysis[]>> {
    try {
      const { data, error } = await supabase.rpc("get_recipe_cost_analysis");

      if (error) {
        return fail(
          mapReadError(error, "Failed to load recipe cost analysis"),
        );
      }

      try {
        return ok(mapGetRecipeCostAnalysisResult(data));
      } catch {
        return fail("Recipe cost analysis response was invalid.");
      }
    } catch (error) {
      return fail(
        mapReadError(error, "Failed to load recipe cost analysis"),
      );
    }
  },

  /**
   * Load one recipe cost analysis row via get_recipe_cost RPC.
   */
  async getRecipeCost(
    recipeId: string,
  ): Promise<ServiceResult<RecipeCostAnalysis>> {
    try {
      const trimmedId = recipeId?.trim() ?? "";
      if (!trimmedId || !UUID_RE.test(trimmedId)) {
        return fail("Recipe id is required.");
      }

      const { data, error } = await supabase.rpc("get_recipe_cost", {
        p_recipe_id: trimmedId,
      });

      if (error) {
        return fail(mapReadError(error, "Failed to load recipe cost"));
      }

      if (data === null) {
        return fail("Recipe cost was not found.");
      }

      try {
        return ok(mapRecipeCostAnalysisRow(data));
      } catch {
        return fail("Recipe cost response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load recipe cost"));
    }
  },
};
