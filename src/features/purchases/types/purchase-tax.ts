/**
 * Purchases → calculate_purchase_taxes RPC contracts (DEV-099, V1 plan 1.6).
 *
 * Purchases requests tax calculation only — no rates/rules knowledge.
 */

import type { TaxPriceMode } from "@/types/tax-engine";

/**
 * Opaque tax category codes used on purchase lines.
 * Country Packs interpret these; Purchases does not resolve rates.
 */
export const PURCHASE_TAX_CATEGORY_OPTIONS = [
  "goods",
  "services",
  "digital_services",
  "food",
  "alcohol",
  "transport",
] as const;

export type PurchaseTaxCategoryCode =
  (typeof PURCHASE_TAX_CATEGORY_OPTIONS)[number];

/**
 * Optional regime override hints for Country Pack rule matching.
 */
export const PURCHASE_TAX_REGIME_OPTIONS = [
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

export type PurchaseTaxRegimeCode =
  (typeof PURCHASE_TAX_REGIME_OPTIONS)[number];

/**
 * Default regime to apply when a line's tax category changes, so a plain
 * category pick resolves a tax rule instead of silently zeroing (V1 plan 1.12).
 * goods/services keep standard_vat as default even though other regimes
 * (zero_rate, exempt, etc.) are also valid for them in specific cases —
 * the user can still override the regime select manually.
 */
export const DEFAULT_TAX_REGIME_BY_CATEGORY: Record<
  PurchaseTaxCategoryCode,
  PurchaseTaxRegimeCode
> = {
  goods: "standard_vat",
  services: "standard_vat",
  digital_services: "standard_vat",
  food: "reduced_vat",
  alcohol: "standard_vat",
  transport: "standard_vat",
};

export interface PurchaseTaxLineInput {
  line_id: string;
  quantity: number;
  unit_price: number;
  discount?: number;
  /**
   * Whether `unit_price` already includes tax.
   * Omitted / exclusive = current Purchases default.
   */
  price_mode?: TaxPriceMode;
  tax_category: string;
  tax_regime?: string | null;
  /** Optional explicit tax code override for Tax Integration. */
  tax_code?: string | null;
}

export interface PurchaseTaxDocument {
  document_id?: string | null;
  company: {
    company_id: string;
    legal_name?: string | null;
    base_currency?: string | null;
  };
  /** ISO country selecting the Tax Country Pack (usually company country). */
  country: string;
  jurisdiction?: string | null;
  transaction_date: string;
  currency: string;
  supplier: {
    supplier_id: string | null;
    name?: string | null;
    /** Required for tax calculation. */
    country_code: string | null;
  };
  lines: readonly PurchaseTaxLineInput[];
}

export interface PurchaseTaxLineView {
  line_id: string;
  tax_code: string | null;
  tax_rate_percent: number | null;
  tax_amount: number;
  taxable_amount: number;
  net_amount: number;
  gross_amount: number;
}

/**
 * Flat per-tax breakdown line from calculate_purchase_taxes, one row per
 * (purchase line, resolved tax) pair. Used by purchase-accounting-service.ts
 * to build Accounting event tax facts.
 */
export interface PurchaseTaxBreakdownLine {
  tax_code: string;
  direction: "input" | "output" | "neutral";
  rate_value: number;
  net_amount: number;
  tax_amount: number;
}

export interface PurchaseTaxResult {
  document_id: string | null;
  mode: "calculate" | "preview" | "validate";
  is_valid: boolean;
  subtotal: number;
  tax_total: number;
  grand_total: number;
  effective_tax_rate: number;
  lines: readonly PurchaseTaxLineView[];
  /** Empty after sql/112; unmatched rules fail the RPC instead of warning. */
  warnings: readonly string[];
  /** Flattened tax breakdown for advanced callers (e.g. Accounting). */
  tax_result: {
    currency: string;
    breakdown: {
      lines: readonly PurchaseTaxBreakdownLine[];
    };
  };
}
