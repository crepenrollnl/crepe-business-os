import type { RecipeCostRole } from "../types/recipe-cost-report";

export function recipeCostRoleLabel(role: RecipeCostRole): string {
  return role === "assembly" ? "Product" : "Semi-finished";
}

export function formatRecipeCostYield(
  yieldQuantity: number,
  yieldUnit: string,
): string {
  const quantity = Number.isInteger(yieldQuantity)
    ? String(yieldQuantity)
    : yieldQuantity.toFixed(3);

  return `${quantity} ${yieldUnit}`;
}
