import {
  generatePurchaseDrafts,
  type IngredientRequirement,
  type PlanningResult,
  type ProcurementRecommendation,
  type PurchaseDraftCollection,
  type ShoppingList,
} from "@/features/production-planning";
import type {
  CalculatedIngredientRequirement,
  CalculatedProcurementItem,
  CalculatedPurchaseDraftReviewLine,
  CalculatedPurchaseDraftReviewSummary,
  CalculatedShoppingListItem,
  ProductionPlanCalculationResult,
} from "../types/production";
import { deriveIngredientRequirementStatus } from "./derive-ingredient-requirement-status";
import { formatProcurementReason } from "./format-procurement-reason";

const EMPTY_PURCHASE_DRAFT_SUMMARY: CalculatedPurchaseDraftReviewSummary = {
  items: 0,
  packages: 0,
  total_purchase_quantity: 0,
};

function mapIngredientRequirement(
  requirement: IngredientRequirement,
): CalculatedIngredientRequirement {
  return {
    ingredient_id: requirement.ingredientId,
    ingredient_name: requirement.ingredientName,
    required_quantity: requirement.requiredQuantity,
    available_quantity: requirement.availableQuantity,
    missing_quantity: requirement.shortageQuantity,
    unit: requirement.unit,
    status: deriveIngredientRequirementStatus(
      requirement.availableQuantity,
      requirement.shortageQuantity,
    ),
  };
}

function mapShoppingListItem(
  item: ShoppingList["items"][number],
): CalculatedShoppingListItem {
  return {
    ingredient_id: item.ingredientId,
    ingredient_name: item.ingredientName,
    quantity: item.shortageQuantity,
    unit: item.unit,
  };
}

function mapProcurementItem(
  item: ProcurementRecommendation["items"][number],
): CalculatedProcurementItem {
  return {
    ingredient_id: item.ingredientId,
    ingredient_name: item.ingredientName,
    recommended_quantity: item.recommendedPurchaseQuantity,
    packages: item.packagesToBuy,
    reason: formatProcurementReason(item.recommendationReason),
    unit: item.unit,
  };
}

function mapPurchaseDraftReviewFromCollection(
  collection: PurchaseDraftCollection,
): {
  lines: CalculatedPurchaseDraftReviewLine[];
  summary: CalculatedPurchaseDraftReviewSummary;
} {
  const lines: CalculatedPurchaseDraftReviewLine[] = [];
  let totalPackages = 0;

  for (const draft of collection.drafts) {
    for (const line of draft.lines) {
      totalPackages += line.packagesToBuy;
      lines.push({
        supplier_name: draft.supplierName ?? null,
        ingredient_id: line.ingredientId,
        ingredient_name: line.ingredientName,
        quantity: line.recommendedPurchaseQuantity,
        packages: line.packagesToBuy,
        reason: formatProcurementReason(line.recommendationReason),
        unit: line.unit,
      });
    }
  }

  lines.sort((a, b) => {
    const supplierCompare = (a.supplier_name ?? "").localeCompare(
      b.supplier_name ?? "",
    );
    if (supplierCompare !== 0) {
      return supplierCompare;
    }
    return a.ingredient_name.localeCompare(b.ingredient_name);
  });

  return {
    lines,
    summary: {
      items: collection.summary.totalLines,
      packages: totalPackages,
      total_purchase_quantity: collection.summary.totalPurchaseQuantity,
    },
  };
}

/**
 * Build Purchase Draft Review rows from a procurement recommendation.
 * Uses the domain Purchase Draft Builder — no persistence.
 */
function mapPurchaseDraftReview(recommendation: ProcurementRecommendation): {
  lines: CalculatedPurchaseDraftReviewLine[];
  summary: CalculatedPurchaseDraftReviewSummary;
} {
  if (recommendation.items.length === 0) {
    return { lines: [], summary: EMPTY_PURCHASE_DRAFT_SUMMARY };
  }

  const drafts = generatePurchaseDrafts({ recommendation });

  if (!drafts.ok) {
    // Recommendation from the live pipeline should always draft cleanly;
    // fall back to flat procurement rows so the workspace still renders.
    const lines = recommendation.items
      .map((item) => ({
        supplier_name: item.supplierName ?? null,
        ingredient_id: item.ingredientId,
        ingredient_name: item.ingredientName,
        quantity: item.recommendedPurchaseQuantity,
        packages: item.packagesToBuy,
        reason: formatProcurementReason(item.recommendationReason),
        unit: item.unit,
      }))
      .sort((a, b) => a.ingredient_name.localeCompare(b.ingredient_name));

    return {
      lines,
      summary: {
        items: lines.length,
        packages: lines.reduce((sum, line) => sum + line.packages, 0),
        total_purchase_quantity: lines.reduce(
          (sum, line) => sum + line.quantity,
          0,
        ),
      },
    };
  }

  return mapPurchaseDraftReviewFromCollection(drafts.collection);
}

/**
 * Map domain pipeline outputs to Production Plan workspace view models.
 * Pure — no I/O.
 */
export function mapPlanCalculationResult(
  planningResult: PlanningResult,
  shoppingList: ShoppingList,
  recommendation: ProcurementRecommendation,
): ProductionPlanCalculationResult {
  const ingredient_requirements = planningResult.ingredientRequirements
    .map(mapIngredientRequirement)
    .sort((a, b) => a.ingredient_name.localeCompare(b.ingredient_name));

  const shopping_list = shoppingList.items
    .map(mapShoppingListItem)
    .sort((a, b) => a.ingredient_name.localeCompare(b.ingredient_name));

  const procurement_recommendations = recommendation.items
    .map(mapProcurementItem)
    .sort((a, b) => a.ingredient_name.localeCompare(b.ingredient_name));

  const purchaseDraft = mapPurchaseDraftReview(recommendation);

  return {
    ingredient_requirements,
    shopping_list,
    procurement_recommendations,
    purchase_draft_review: purchaseDraft.lines,
    purchase_draft_summary: purchaseDraft.summary,
    has_shortages: planningResult.summary.hasShortages,
  };
}
