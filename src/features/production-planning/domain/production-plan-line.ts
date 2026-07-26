import type { EntityId, Quantity, Unit } from "@/types/erp";

/**
 * One planned finished-good output line on a Production Plan.
 * Quantities are planned intent only — no stock effect.
 */
export interface ProductionPlanLine {
  finishedGoodId: EntityId;
  recipeId: EntityId;
  plannedQuantity: Quantity;
  unit: Unit;
}
