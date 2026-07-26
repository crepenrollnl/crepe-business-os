/**
 * Purchases → Tax Integration contracts (DEV-099).
 *
 * Purchases requests tax calculation only — no rates/rules knowledge.
 */

import type {
  TaxResult,
  TaxValidationWarning,
} from "@/features/tax-integration";

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

export interface PurchaseTaxLineInput {
  line_id: string;
  quantity: number;
  unit_price: number;
  discount?: number;
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

export interface PurchaseTaxResult {
  document_id: string | null;
  mode: "calculate" | "preview" | "validate";
  is_valid: boolean;
  subtotal: number;
  tax_total: number;
  grand_total: number;
  effective_tax_rate: number;
  lines: readonly PurchaseTaxLineView[];
  warnings: readonly TaxValidationWarning[];
  /** Full integration result for advanced callers. */
  tax_result: TaxResult;
}
