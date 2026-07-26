import type { EntityId, Quantity } from "@/types/erp";

/**
 * Provides read-only inventory availability for planning.
 *
 * Must never deduct, reserve, or otherwise modify stock.
 * Planning uses availability only to compute shortages.
 *
 * Interface only — no database in this package.
 */
export interface InventoryAvailabilityProvider {
  /**
   * Current available quantity for an ingredient (raw material).
   */
  getAvailableQuantity(ingredientId: EntityId): Quantity;

  /**
   * Batch read of available quantities. Missing ids default to 0 at call sites.
   */
  getAvailableQuantities(
    ingredientIds: readonly EntityId[],
  ): ReadonlyMap<EntityId, Quantity>;
}
