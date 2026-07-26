import type { EntityId, Money, Quantity, Unit } from "@/types/erp";

/**
 * Typed reasons explaining why a procurement recommendation was produced.
 * Avoid magic strings — use this catalog only.
 */
export const PROCUREMENT_RECOMMENDATION_REASONS = [
  "ExactQuantity",
  "RoundedToPackage",
  "MinimumOrder",
  "SupplierRestriction",
  "NoPackagingData",
] as const;

export type ProcurementRecommendationReason =
  (typeof PROCUREMENT_RECOMMENDATION_REASONS)[number];

export function isProcurementRecommendationReason(
  value: string,
): value is ProcurementRecommendationReason {
  return (PROCUREMENT_RECOMMENDATION_REASONS as readonly string[]).includes(
    value,
  );
}

/**
 * Optional packaging / supplier metadata for an ingredient.
 * Supplied alongside a ShoppingList — not persisted by this engine.
 */
export interface IngredientPackagingInfo {
  ingredientId: EntityId;
  /** Optional supplier metadata only — no supplier optimization in this version. */
  supplierId?: EntityId;
  supplierName?: string;
  /** Purchase package size in the same unit family as the shopping-list shortage. */
  packageSize?: Quantity;
  packageUnit?: Unit;
}

/**
 * One procurement recommendation line derived from a shopping-list shortage.
 */
export interface ProcurementRecommendationItem {
  ingredientId: EntityId;
  ingredientName: string;
  shortageQuantity: Quantity;
  recommendedPurchaseQuantity: Quantity;
  unit: Unit;
  supplierId?: EntityId;
  supplierName?: string;
  packageSize?: Quantity;
  packageUnit?: Unit;
  /** Number of packages to buy (1 when no packaging data). */
  packagesToBuy: number;
  roundingApplied: boolean;
  recommendationReason: ProcurementRecommendationReason;
}

/**
 * Aggregate counters for a procurement recommendation.
 */
export interface ProcurementRecommendationSummary {
  totalIngredients: number;
  totalPackages: number;
  totalPurchaseQuantity: Quantity;
  /** Future: estimated purchase cost across all lines. */
  estimatedCost?: Money;
  /** Future: distinct suppliers represented in the recommendation. */
  supplierCount?: number;
}

/**
 * Procurement recommendation produced from a ShoppingList.
 * Pure value object — never creates Purchases or persists data.
 */
export interface ProcurementRecommendation {
  items: readonly ProcurementRecommendationItem[];
  summary: ProcurementRecommendationSummary;
}
