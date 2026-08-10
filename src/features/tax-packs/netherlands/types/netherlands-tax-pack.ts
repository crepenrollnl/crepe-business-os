/**
 * Netherlands Tax Pack contracts (DEV-097).
 *
 * Configuration / registration only. All calculation stays in Tax Engine.
 */

import type {
  TaxCalculationContext,
  TaxCategory,
  TaxDefinition,
  TaxJurisdiction,
  TaxRate,
  TaxRule,
  TaxType,
} from "@/types/tax-engine";

/**
 * Netherlands tax regimes registered by this pack.
 */
export type NetherlandsTaxRegime =
  | "standard_vat"
  | "reduced_vat"
  | "zero_rate"
  | "exempt"
  | "reverse_charge"
  | "intra_community_supply"
  | "import"
  | "export"
  | "small_business_scheme_kor";

export const NETHERLANDS_TAX_REGIMES: readonly NetherlandsTaxRegime[] = [
  "standard_vat",
  "reduced_vat",
  "zero_rate",
  "exempt",
  "reverse_charge",
  "intra_community_supply",
  "import",
  "export",
  "small_business_scheme_kor",
] as const;

export type NetherlandsTaxCategoryCode =
  | "goods"
  | "services"
  | "digital_services"
  | "food"
  | "alcohol"
  | "transport";

/**
 * Pack-side link from a TaxDefinition to a Netherlands regime.
 * Regime is Localization Pack metadata — not a Tax Engine concept.
 */
export interface NetherlandsTaxDefinitionRegistration {
  regime: NetherlandsTaxRegime;
  definition: TaxDefinition;
}

export interface NetherlandsTaxPack {
  pack_id: "netherlands";
  pack_version: string;
  jurisdiction: TaxJurisdiction;
  categories: readonly TaxCategory[];
  types: readonly TaxType[];
  regimes: readonly NetherlandsTaxRegime[];
  definitions: readonly NetherlandsTaxDefinitionRegistration[];
  rates: readonly TaxRate[];
  rules: readonly TaxRule[];
}

export type NetherlandsTaxPackValidationCode =
  | "DUPLICATE_TAX_CODE"
  | "INVALID_REGIME"
  | "INACTIVE_TAX"
  | "INVALID_EFFECTIVE_DATES"
  | "OVERLAPPING_RULES"
  | "INVALID_PACK";

export interface NetherlandsTaxPackValidationError {
  code: NetherlandsTaxPackValidationCode;
  message: string;
  details?: Record<string, string | number | boolean | null>;
}

export type NetherlandsTaxPackValidationResult =
  | { ok: true }
  | { ok: false; error: NetherlandsTaxPackValidationError };

export interface BuildNetherlandsTaxContextInput {
  occurredAt: string;
  /** Defaults to Netherlands jurisdiction id from the pack. */
  jurisdictionId?: string;
  /** Optional subset of definitions/rules/rates (defaults to full active pack). */
  includeInactive?: boolean;
}

export type { TaxCalculationContext };
