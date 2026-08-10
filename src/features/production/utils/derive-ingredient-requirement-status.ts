import type { IngredientRequirementStatus } from "../types/production";

/**
 * Map shortage vs available stock to a workspace status label.
 *
 * - Available: no shortage
 * - Missing: shortage and zero stock on hand
 * - Low Stock: shortage with partial stock remaining
 */
export function deriveIngredientRequirementStatus(
  availableQuantity: number,
  missingQuantity: number,
): IngredientRequirementStatus {
  if (missingQuantity <= 0) {
    return "available";
  }

  if (availableQuantity <= 0) {
    return "missing";
  }

  return "low_stock";
}

export function formatIngredientRequirementStatus(
  status: IngredientRequirementStatus,
): string {
  switch (status) {
    case "available":
      return "Available";
    case "low_stock":
      return "Low Stock";
    case "missing":
      return "Missing";
  }
}

export function getIngredientRequirementStatusBadgeClass(
  status: IngredientRequirementStatus,
): string {
  switch (status) {
    case "available":
      return "bg-green-100 text-green-700";
    case "low_stock":
      return "bg-amber-100 text-amber-800";
    case "missing":
      return "bg-red-100 text-red-700";
  }
}
