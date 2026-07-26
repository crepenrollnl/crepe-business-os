import { QUANTITY_DECIMAL_PLACES } from "@/constants/config";
import type { Quantity } from "@/types/erp";

/**
 * Round a non-monetary quantity to the platform decimal precision.
 * Use for stock, recipe scaling, and planning aggregates.
 */
export function roundQuantity(
  value: number,
  decimalPlaces: number = QUANTITY_DECIMAL_PLACES,
): Quantity {
  if (!Number.isFinite(value)) {
    return value;
  }
  const places = Math.max(0, Math.floor(decimalPlaces));
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Add quantities with rounding to reduce floating-point drift.
 */
export function addQuantities(
  a: Quantity,
  b: Quantity,
  decimalPlaces: number = QUANTITY_DECIMAL_PLACES,
): Quantity {
  return roundQuantity(a + b, decimalPlaces);
}
