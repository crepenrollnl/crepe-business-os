/**
 * Country Pack registry for Tax Integration (DEV-098).
 *
 * Selects Localization Pack adapters by ISO country code.
 * Operational modules never touch packs directly.
 */

import type { TaxCalculationContext } from "@/types/tax-engine";
import { fail, ok, type ServiceResult } from "@/types/service";

export interface TaxCountryPackContextInput {
  occurredAt: string;
  currency: string;
  jurisdictionId?: string | null;
  includeInactive?: boolean;
}

export interface TaxCountryPackAdapter {
  /** ISO 3166-1 alpha-2 / alpha-3 codes this adapter serves. */
  country_codes: readonly string[];
  pack_id: string;
  default_jurisdiction_id: string;
  category_codes: readonly string[];
  buildContext(
    input: TaxCountryPackContextInput,
  ): ServiceResult<TaxCalculationContext>;
}

const adapters = new Map<string, TaxCountryPackAdapter>();

function normalizeCountry(country: string): string {
  return country.trim().toUpperCase();
}

export const taxCountryPackRegistry = {
  register(adapter: TaxCountryPackAdapter): void {
    for (const code of adapter.country_codes) {
      adapters.set(normalizeCountry(code), adapter);
    }
  },

  clear(): void {
    adapters.clear();
  },

  get(country: string): TaxCountryPackAdapter | null {
    return adapters.get(normalizeCountry(country)) ?? null;
  },

  resolve(country: string): ServiceResult<TaxCountryPackAdapter> {
    const adapter = this.get(country);
    if (!adapter) {
      return fail(
        `No Tax Country Pack is registered for country '${country.trim()}'.`,
      );
    }
    return ok(adapter);
  },
};
