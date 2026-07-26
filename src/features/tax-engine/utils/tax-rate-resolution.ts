/**
 * Tax Rate Resolution (DEV-096).
 *
 * Active → Effective Date → single rate per definition.
 */

import type { TaxError, TaxRate } from "@/types/tax-engine";
import { taxError } from "./tax-errors";

function toDateOnly(isoOrDate: string): string {
  return isoOrDate.slice(0, 10);
}

function isEffective(
  effectiveFrom: string,
  effectiveTo: string | null,
  dateOnly: string,
): boolean {
  if (effectiveFrom > dateOnly) {
    return false;
  }
  if (effectiveTo !== null && effectiveTo < dateOnly) {
    return false;
  }
  return true;
}

/**
 * Resolve the effective rate for a tax definition on a given date.
 */
export function resolveTaxRate(input: {
  taxDefinitionId: string;
  rates: readonly TaxRate[];
  occurredAt: string;
}): { ok: true; rate: TaxRate } | { ok: false; error: TaxError } {
  const dateOnly = toDateOnly(input.occurredAt);
  const matches = input.rates.filter((rate) => {
    if (!rate.is_active) {
      return false;
    }
    if (rate.tax_definition_id !== input.taxDefinitionId) {
      return false;
    }
    return isEffective(rate.effective_from, rate.effective_to, dateOnly);
  });

  if (matches.length === 0) {
    return {
      ok: false,
      error: taxError(
        "RATE_NOT_FOUND",
        "No active tax rate is effective for the tax definition.",
        { tax_definition_id: input.taxDefinitionId, as_of: dateOnly },
      ),
    };
  }

  // Prefer the rate with the latest effective_from; tie-break by id.
  const sorted = [...matches].sort((a, b) => {
    if (a.effective_from !== b.effective_from) {
      return a.effective_from < b.effective_from ? 1 : -1;
    }
    return a.id.localeCompare(b.id);
  });

  return { ok: true, rate: sorted[0]! };
}
