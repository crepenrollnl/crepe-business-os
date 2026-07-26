/**
 * Cross-module default configuration.
 * Do not put secrets here — environment variables stay in process env.
 */

import type { CurrencyCode } from "@/types/erp";

/** Default currency for operational documents until multi-currency lands. */
export const DEFAULT_CURRENCY: CurrencyCode = "EUR";

/** Display symbol for DEFAULT_CURRENCY in presentational UI. */
export const DEFAULT_CURRENCY_SYMBOL = "€";

/** Locale used for number / date formatting helpers. */
export const DEFAULT_LOCALE = "en-IE";

/** Money decimal places used by `roundMoney`. */
export const MONEY_DECIMAL_PLACES = 2;

/**
 * Quantity decimal places used by `roundQuantity`.
 * Matches operational planning / production stock precision (3 dp).
 */
export const QUANTITY_DECIMAL_PLACES = 3;
