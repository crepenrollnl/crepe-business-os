import type { Quantity } from "@/types/erp";

/**
 * Floating-point tolerance for exact package-multiple detection.
 * Keeps ceil math stable for operational quantity precision.
 */
const PACKAGE_EPSILON = 1e-9;

export interface PackagePurchaseQuantity {
  packagesToBuy: number;
  recommendedPurchaseQuantity: Quantity;
  roundingApplied: boolean;
}

/**
 * Round shortage UP to the nearest valid package multiple.
 *
 * Never returns less than the shortage when packageSize > 0.
 * Callers must validate packageSize before invoking.
 */
export function roundUpToPackageQuantity(
  shortageQuantity: Quantity,
  packageSize: Quantity,
): PackagePurchaseQuantity {
  const rawPackages = shortageQuantity / packageSize;
  const packagesToBuy = Math.max(1, Math.ceil(rawPackages - PACKAGE_EPSILON));
  const recommendedPurchaseQuantity = packagesToBuy * packageSize;
  const roundingApplied =
    recommendedPurchaseQuantity - shortageQuantity > PACKAGE_EPSILON;

  return {
    packagesToBuy,
    recommendedPurchaseQuantity,
    roundingApplied,
  };
}
