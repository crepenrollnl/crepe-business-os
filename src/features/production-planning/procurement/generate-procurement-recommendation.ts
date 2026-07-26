import type { EntityId, Quantity } from "@/types/erp";

import type { ShoppingList, ShoppingListItem } from "../shopping-list/types";
import type { PlanValidationIssue } from "../types/validation";
import { roundUpToPackageQuantity } from "./packaging";
import type {
  IngredientPackagingInfo,
  ProcurementRecommendation,
  ProcurementRecommendationItem,
  ProcurementRecommendationSummary,
} from "./types";
import { validateShoppingListForProcurement } from "./validate-shopping-list-for-procurement";

/**
 * Generator input. All data is passed in — no I/O, no hidden state.
 */
export interface GenerateProcurementRecommendationInput {
  shoppingList: ShoppingList;
  /**
   * Optional packaging / supplier metadata.
   * Supplier selection is metadata-only — no supplier optimization.
   */
  packaging?: readonly IngredientPackagingInfo[];
}

/**
 * Generator output. Business validation never throws.
 */
export type GenerateProcurementRecommendationOutput =
  | { ok: true; recommendation: ProcurementRecommendation }
  | { ok: false; issues: readonly PlanValidationIssue[] };

function buildSummary(
  items: readonly ProcurementRecommendationItem[],
): ProcurementRecommendationSummary {
  let totalPackages = 0;
  let totalPurchaseQuantity: Quantity = 0;

  for (const item of items) {
    totalPackages += item.packagesToBuy;
    totalPurchaseQuantity += item.recommendedPurchaseQuantity;
  }

  return {
    totalIngredients: items.length,
    totalPackages,
    totalPurchaseQuantity,
  };
}

function buildRecommendationItem(
  item: ShoppingListItem,
  packaging: IngredientPackagingInfo | undefined,
): ProcurementRecommendationItem {
  const hasPackageSize =
    packaging?.packageSize !== undefined && packaging.packageSize > 0;

  if (!hasPackageSize) {
    return {
      ingredientId: item.ingredientId,
      ingredientName: item.ingredientName,
      shortageQuantity: item.shortageQuantity,
      recommendedPurchaseQuantity: item.shortageQuantity,
      unit: item.unit,
      supplierId: packaging?.supplierId,
      supplierName: packaging?.supplierName,
      packageSize: packaging?.packageSize,
      packageUnit: packaging?.packageUnit,
      packagesToBuy: 1,
      roundingApplied: false,
      recommendationReason: "NoPackagingData",
    };
  }

  const packageSize = packaging.packageSize as Quantity;
  const purchase = roundUpToPackageQuantity(
    item.shortageQuantity,
    packageSize,
  );

  return {
    ingredientId: item.ingredientId,
    ingredientName: item.ingredientName,
    shortageQuantity: item.shortageQuantity,
    recommendedPurchaseQuantity: purchase.recommendedPurchaseQuantity,
    unit: item.unit,
    supplierId: packaging.supplierId,
    supplierName: packaging.supplierName,
    packageSize,
    packageUnit: packaging.packageUnit,
    packagesToBuy: purchase.packagesToBuy,
    roundingApplied: purchase.roundingApplied,
    recommendationReason: purchase.roundingApplied
      ? "RoundedToPackage"
      : "ExactQuantity",
  };
}

/**
 * Procurement Recommendation Engine (DEV-005).
 *
 * Converts a Shopping List into optimal purchasing recommendations.
 *
 * Rules:
 * - No packaging → recommendedPurchaseQuantity = shortageQuantity
 * - With packaging → round UP to the nearest valid package quantity
 * - Never recommend less than the shortage
 * - Supplier metadata is optional; no supplier optimization
 * - Never creates Purchases, drafts, inventory mutations, or persistence
 *
 * This is the only approved way to generate procurement recommendations
 * from a Shopping List.
 */
export function generateProcurementRecommendation(
  input: GenerateProcurementRecommendationInput,
): GenerateProcurementRecommendationOutput {
  const packaging = input.packaging ?? [];
  const validation = validateShoppingListForProcurement(
    input.shoppingList,
    packaging,
  );

  if (!validation.ok) {
    return { ok: false, issues: validation.issues };
  }

  const packagingByIngredient = new Map<EntityId, IngredientPackagingInfo>();
  for (const entry of packaging) {
    packagingByIngredient.set(entry.ingredientId, entry);
  }

  const items: ProcurementRecommendationItem[] = [];

  for (const shoppingItem of input.shoppingList.items) {
    items.push(
      buildRecommendationItem(
        shoppingItem,
        packagingByIngredient.get(shoppingItem.ingredientId),
      ),
    );
  }

  const recommendation: ProcurementRecommendation = {
    items,
    summary: buildSummary(items),
  };

  return { ok: true, recommendation };
}
