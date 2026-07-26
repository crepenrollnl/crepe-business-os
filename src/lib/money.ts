import { MONEY_DECIMAL_PLACES } from "@/constants/config";

/**
 * Round a monetary amount to the platform decimal precision.
 * Use before persisting line totals and document totals.
 */
export function roundMoney(value: number): number {
  const factor = 10 ** MONEY_DECIMAL_PLACES;
  return Math.round(value * factor) / factor;
}

/**
 * Multiply quantity × unit price/cost and round to money precision.
 */
export function calculateMoneyLineTotal(
  quantity: number,
  unitAmount: number,
): number {
  return roundMoney(quantity * unitAmount);
}
