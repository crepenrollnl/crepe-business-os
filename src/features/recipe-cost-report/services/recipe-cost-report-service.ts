/**
 * Recipe cost report read service (sql/122).
 *
 * Reads exclusively via get_recipe_cost_report and get_recipe_cost_detail.
 * Does not persist or recalculate recipe costs in TypeScript.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import {
  RECIPE_COST_ROLES,
  type RecipeCostDetail,
  type RecipeCostIngredientBreakdown,
  type RecipeCostMissingIngredient,
  type RecipeCostReportRow,
  type RecipeCostRole,
} from "../types/recipe-cost-report";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toNumber(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new Error(`${label} is invalid.`);
}

function toNullableNumber(value: unknown, label: string): number | null {
  if (value === null) {
    return null;
  }
  return toNumber(value, label);
}

function toNonEmptyString(value: unknown, label: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  throw new Error(`${label} is invalid.`);
}

function toBoolean(value: unknown, label: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  throw new Error(`${label} is invalid.`);
}

function toNullableBoolean(value: unknown, label: string): boolean | null {
  if (value === null) {
    return null;
  }
  return toBoolean(value, label);
}

function toOptionalNullableString(
  value: unknown,
  label: string,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return toNonEmptyString(value, label);
}

function isRecipeCostRole(value: unknown): value is RecipeCostRole {
  return (
    typeof value === "string" &&
    (RECIPE_COST_ROLES as readonly string[]).includes(value)
  );
}

function mapMissingIngredient(
  payload: unknown,
): RecipeCostMissingIngredient {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Missing ingredient row is invalid.");
  }
  const row = payload as Record<string, unknown>;
  const ingredientId = toNonEmptyString(
    row.ingredient_id,
    "Missing ingredient id",
  );
  if (!UUID_RE.test(ingredientId)) {
    throw new Error("Missing ingredient id is invalid.");
  }

  return {
    ingredient_id: ingredientId,
    ingredient_name: toNonEmptyString(
      row.ingredient_name,
      "Missing ingredient name",
    ),
    unit: toNonEmptyString(row.unit, "Missing ingredient unit"),
  };
}

function mapMissingIngredients(
  payload: unknown,
): RecipeCostMissingIngredient[] | null {
  if (payload === null) {
    return null;
  }
  if (!Array.isArray(payload)) {
    throw new Error("Missing ingredients are invalid.");
  }
  return payload.map(mapMissingIngredient);
}

function mapBreakdownLine(payload: unknown): RecipeCostIngredientBreakdown {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Ingredient breakdown row is invalid.");
  }
  const row = payload as Record<string, unknown>;
  const ingredientId = toNonEmptyString(
    row.ingredient_id,
    "Breakdown ingredient id",
  );
  if (!UUID_RE.test(ingredientId)) {
    throw new Error("Breakdown ingredient id is invalid.");
  }

  return {
    ingredient_id: ingredientId,
    ingredient_name: toNonEmptyString(
      row.ingredient_name,
      "Breakdown ingredient name",
    ),
    quantity: toNumber(row.quantity, "Breakdown quantity"),
    unit: toNonEmptyString(row.unit, "Breakdown unit"),
    cost_per_unit: toNullableNumber(row.cost_per_unit, "Breakdown cost per unit"),
    line_cost: toNumber(row.line_cost, "Breakdown line cost"),
  };
}

function mapReportRow(payload: unknown): RecipeCostReportRow {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Recipe cost row is invalid.");
  }

  const row = payload as Record<string, unknown>;
  const recipeId = toNonEmptyString(row.recipe_id, "Recipe id");
  if (!UUID_RE.test(recipeId)) {
    throw new Error("Recipe id is invalid.");
  }
  if (!isRecipeCostRole(row.recipe_role)) {
    throw new Error("Recipe role is invalid.");
  }

  return {
    recipe_id: recipeId,
    recipe_name: toNonEmptyString(row.recipe_name, "Recipe name"),
    recipe_role: row.recipe_role,
    yield_quantity: toNumber(row.yield_quantity, "Yield quantity"),
    yield_unit: toNonEmptyString(row.yield_unit, "Yield unit"),
    is_active: toBoolean(row.is_active, "Active flag"),
    selling_price: toNullableNumber(row.selling_price, "Selling price"),
    total_cost: toNullableNumber(row.total_cost, "Total cost"),
    cost_per_yield_unit: toNullableNumber(
      row.cost_per_yield_unit,
      "Cost per yield unit",
    ),
    has_missing_cost_data: toNullableBoolean(
      row.has_missing_cost_data,
      "Missing cost flag",
    ),
    missing_ingredients: mapMissingIngredients(row.missing_ingredients),
    calculation_error: toOptionalNullableString(
      row.calculation_error,
      "Calculation error",
    ),
  };
}

function mapReport(payload: unknown): RecipeCostReportRow[] {
  if (!Array.isArray(payload)) {
    throw new Error("Recipe cost report payload is invalid.");
  }
  return payload.map(mapReportRow);
}

function mapDetail(payload: unknown): RecipeCostDetail {
  const summary = mapReportRow(payload);
  const row = payload as Record<string, unknown>;
  const breakdown = row.ingredient_breakdown;
  if (!Array.isArray(breakdown)) {
    throw new Error("Ingredient breakdown is invalid.");
  }

  return {
    ...summary,
    ingredient_breakdown: breakdown.map(mapBreakdownLine),
  };
}

function mapReportError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message =
        typeof err === "object" &&
        err !== null &&
        "message" in err &&
        typeof (err as { message: unknown }).message === "string"
          ? (err as { message: string }).message
          : typeof err === "string"
            ? err
            : null;

      if (!message) {
        return null;
      }

      const normalized = message.toLowerCase();
      if (
        (normalized.includes("get_recipe_cost_report") ||
          normalized.includes("get_recipe_cost_detail") ||
          normalized.includes("calculate_recipe_cost")) &&
        (normalized.includes("does not exist") ||
          normalized.includes("schema cache") ||
          normalized.includes("42883"))
      ) {
        return "Recipe cost is not available yet. Apply the recipe cost database script and try again.";
      }

      if (normalized.includes("insufficient permissions")) {
        return "You do not have permission to view recipe cost.";
      }

      if (normalized.includes("recipe id is required")) {
        return "Recipe id is required.";
      }

      if (normalized.includes("recipe was not found")) {
        return "Recipe was not found.";
      }

      if (
        normalized.includes("cycle") ||
        normalized.includes("circular") ||
        normalized.includes("has an invalid yield")
      ) {
        return message;
      }

      return null;
    },
  });
}

export const recipeCostReportService = {
  async getRecipeCostReport(): Promise<ServiceResult<RecipeCostReportRow[]>> {
    try {
      const { data, error } = await supabase.rpc("get_recipe_cost_report");

      if (error || data == null) {
        return fail(mapReportError(error, "Failed to load recipe cost."));
      }

      try {
        return ok(mapReport(data));
      } catch {
        return fail("Recipe cost report response was invalid.");
      }
    } catch (error) {
      return fail(mapReportError(error, "Failed to load recipe cost."));
    }
  },

  async getRecipeCostDetail(
    recipeId: string,
  ): Promise<ServiceResult<RecipeCostDetail>> {
    try {
      const trimmedId = recipeId?.trim() ?? "";
      if (!trimmedId || !UUID_RE.test(trimmedId)) {
        return fail("Recipe id is required.");
      }

      const { data, error } = await supabase.rpc("get_recipe_cost_detail", {
        p_recipe_id: trimmedId,
      });

      if (error || data == null) {
        return fail(mapReportError(error, "Failed to load recipe cost detail."));
      }

      try {
        return ok(mapDetail(data));
      } catch {
        return fail("Recipe cost detail response was invalid.");
      }
    } catch (error) {
      return fail(mapReportError(error, "Failed to load recipe cost detail."));
    }
  },
};
