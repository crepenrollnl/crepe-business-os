import {
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  MONEY_DECIMAL_PLACES,
} from "@/constants/config";

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

const moneyFormatter = new Intl.NumberFormat(DEFAULT_LOCALE, {
  style: "currency",
  currency: DEFAULT_CURRENCY,
});

const unitCostFormatter = new Intl.NumberFormat(DEFAULT_LOCALE, {
  style: "currency",
  currency: DEFAULT_CURRENCY,
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

/**
 * Display-only formatting for a monetary amount, e.g. "€12,345.60".
 * Never use this for persisted/calculated values — display formatting only.
 */
export function formatMoney(value: number): string {
  return moneyFormatter.format(value);
}

/**
 * Display-only formatting for per-unit costs at 4 decimal places
 * (e.g. cost per gram), where the 2 decimal places of `formatMoney`
 * would round small fractional costs to €0.00.
 */
export function formatUnitCost(value: number): string {
  return unitCostFormatter.format(value);
}
