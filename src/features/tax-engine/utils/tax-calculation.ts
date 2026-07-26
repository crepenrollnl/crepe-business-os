/**
 * Generic tax amount calculator (DEV-096).
 *
 * Application-method mechanics only. No regime-specific formulas.
 */

import type {
  TaxApplicationMethod,
  TaxCalculator,
  TaxPriceMode,
} from "@/types/tax-engine";

function computeExclusiveFromInclusive(
  gross: number,
  rateValue: number,
): { net: number; tax: number } {
  if (rateValue <= -1) {
    return { net: gross, tax: 0 };
  }
  const net = gross / (1 + rateValue);
  const tax = gross - net;
  return { net, tax };
}

/**
 * Default calculator for built-in application methods.
 */
export const defaultTaxCalculator: TaxCalculator = {
  calculate(input) {
    const { method, rateValue, amount, quantity, priceMode } = input;

    switch (method) {
      case "percentage_of_base": {
        if (priceMode === "inclusive") {
          const { net, tax } = computeExclusiveFromInclusive(amount, rateValue);
          return {
            taxableBase: net,
            taxAmount: tax,
            netAmount: net,
            grossAmount: amount,
          };
        }
        const tax = amount * rateValue;
        return {
          taxableBase: amount,
          taxAmount: tax,
          netAmount: amount,
          grossAmount: amount + tax,
        };
      }
      case "percentage_of_gross": {
        // Treat supplied amount as gross; tax = gross * rate; net = gross - tax.
        const tax = amount * rateValue;
        const net = amount - tax;
        return {
          taxableBase: amount,
          taxAmount: tax,
          netAmount: net,
          grossAmount: amount,
        };
      }
      case "fixed_amount": {
        const tax = rateValue;
        if (priceMode === "inclusive") {
          return {
            taxableBase: amount - tax,
            taxAmount: tax,
            netAmount: amount - tax,
            grossAmount: amount,
          };
        }
        return {
          taxableBase: amount,
          taxAmount: tax,
          netAmount: amount,
          grossAmount: amount + tax,
        };
      }
      case "amount_per_quantity": {
        const tax = rateValue * quantity;
        if (priceMode === "inclusive") {
          return {
            taxableBase: amount - tax,
            taxAmount: tax,
            netAmount: amount - tax,
            grossAmount: amount,
          };
        }
        return {
          taxableBase: amount,
          taxAmount: tax,
          netAmount: amount,
          grossAmount: amount + tax,
        };
      }
      default: {
        const _exhaustive: never = method;
        return _exhaustive;
      }
    }
  },
};

export function isTaxApplicationMethod(
  value: unknown,
): value is TaxApplicationMethod {
  return (
    value === "percentage_of_base" ||
    value === "percentage_of_gross" ||
    value === "fixed_amount" ||
    value === "amount_per_quantity"
  );
}

export type { TaxPriceMode };
