/**
 * Canonical unit catalogs for ERP modules.
 *
 * Inventory currently accepts free-text units; these catalogs are the
 * recommended vocabulary for new forms and validations.
 */

/** Common raw-material / ingredient units. */
export const INVENTORY_UNITS = [
  "kg",
  "g",
  "L",
  "ml",
  "pcs",
  "pack",
  "box",
  "bottle",
] as const;

export type InventoryUnit = (typeof INVENTORY_UNITS)[number];

/** Recipe yield units (kept in sync with Recipes feature). */
export const YIELD_UNITS = [
  "portion",
  "pcs",
  "kg",
  "g",
  "L",
  "ml",
] as const;

export type YieldUnit = (typeof YIELD_UNITS)[number];

export const DEFAULT_YIELD_UNIT: YieldUnit = "portion";

export function isInventoryUnit(value: string): value is InventoryUnit {
  return (INVENTORY_UNITS as readonly string[]).includes(value);
}

export function isYieldUnit(value: string): value is YieldUnit {
  return (YIELD_UNITS as readonly string[]).includes(value);
}
