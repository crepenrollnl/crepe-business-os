/**
 * Netherlands Tax Pack service (DEV-097).
 *
 * Registers NL-specific tax configuration for the generic Tax Engine.
 * Contains no calculation logic — Tax Engine performs all math.
 *
 * Does NOT:
 *   - modify Tax Engine Core
 *   - persist SQL / RPC
 *   - expose UI / hooks
 *   - change Accounting
 */

import { createTaxRoundingStrategy } from "@/features/tax-engine";
import type { TaxCalculationContext, TaxDefinition } from "@/types/tax-engine";
import { fail, ok, type ServiceResult } from "@/types/service";
import {
  NL_JURISDICTION_ID,
  NL_PACK_ID,
  NL_PACK_VERSION,
} from "../constants/ids";
import {
  netherlandsDefinitionRegistrations,
  netherlandsJurisdiction,
  netherlandsTaxCategories,
  netherlandsTaxRates,
  netherlandsTaxRules,
  netherlandsTaxTypes,
} from "../data/pack-data";
import {
  NETHERLANDS_TAX_REGIMES,
  type BuildNetherlandsTaxContextInput,
  type NetherlandsTaxPack,
  type NetherlandsTaxRegime,
} from "../types/netherlands-tax-pack";
import { validateNetherlandsTaxPack } from "../utils/pack-validation";

function buildPack(): NetherlandsTaxPack {
  return {
    pack_id: NL_PACK_ID,
    pack_version: NL_PACK_VERSION,
    jurisdiction: netherlandsJurisdiction,
    categories: netherlandsTaxCategories,
    types: netherlandsTaxTypes,
    regimes: NETHERLANDS_TAX_REGIMES,
    definitions: netherlandsDefinitionRegistrations,
    rates: netherlandsTaxRates,
    rules: netherlandsTaxRules,
  };
}

export const netherlandsTaxPackService = {
  /**
   * Return the registered Netherlands Tax Pack configuration.
   */
  getPack(): ServiceResult<NetherlandsTaxPack> {
    const pack = buildPack();
    const validation = validateNetherlandsTaxPack(pack);
    if (!validation.ok) {
      return fail(validation.error.message);
    }
    return ok(pack);
  },

  /**
   * Validate an arbitrary pack snapshot (tests / future overrides).
   */
  validatePack(pack: NetherlandsTaxPack): ServiceResult<true> {
    const validation = validateNetherlandsTaxPack(pack);
    if (!validation.ok) {
      return fail(validation.error.message);
    }
    return ok(true);
  },

  /**
   * List registered Netherlands regimes.
   */
  listRegimes(): readonly NetherlandsTaxRegime[] {
    return NETHERLANDS_TAX_REGIMES;
  },

  /**
   * Resolve TaxDefinition for a regime from the pack registry.
   */
  getDefinitionForRegime(
    regime: NetherlandsTaxRegime,
  ): ServiceResult<TaxDefinition> {
    if (!NETHERLANDS_TAX_REGIMES.includes(regime)) {
      return fail("Unknown Netherlands tax regime.");
    }

    const registration = netherlandsDefinitionRegistrations.find(
      (row) => row.regime === regime,
    );
    if (!registration) {
      return fail("Netherlands tax regime has no registered definition.");
    }

    return ok(registration.definition);
  },

  /**
   * Build a TaxCalculationContext for the generic Tax Engine.
   */
  buildTaxContext(
    input: BuildNetherlandsTaxContextInput,
  ): ServiceResult<TaxCalculationContext> {
    const packResult = this.getPack();
    if (packResult.error || !packResult.data) {
      return fail(packResult.error ?? "Failed to load Netherlands Tax Pack");
    }

    const pack = packResult.data;
    const includeInactive = input.includeInactive === true;

    const definitions = pack.definitions
      .map((row) => row.definition)
      .filter((definition) => includeInactive || definition.is_active);

    const definitionIds = new Set(definitions.map((row) => row.id));

    const rules = pack.rules.filter((rule) => {
      if (!includeInactive && !rule.is_active) {
        return false;
      }
      return definitionIds.has(rule.tax_definition_id);
    });

    const rates = pack.rates.filter((rate) => {
      if (!includeInactive && !rate.is_active) {
        return false;
      }
      return definitionIds.has(rate.tax_definition_id);
    });

    return ok({
      occurred_at: input.occurredAt,
      currency: "EUR",
      jurisdiction_id: input.jurisdictionId ?? NL_JURISDICTION_ID,
      rounding: createTaxRoundingStrategy("half_up", 2),
      definitions,
      types: pack.types,
      rates,
      rules,
      categories: pack.categories,
      jurisdictions: [pack.jurisdiction],
    });
  },
};
